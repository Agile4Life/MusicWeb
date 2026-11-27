use std::cell::UnsafeCell;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Lock-free Single-Producer Single-Consumer ring buffer for realtime audio frames.
/// Capacity must be a power of two.
pub struct SpscRing<T = f32> {
    buf: UnsafeCell<Vec<T>>,
    mask: usize,
    head: AtomicUsize, // read index
    tail: AtomicUsize, // write index
}

unsafe impl<T: Send> Send for SpscRing<T> {}
unsafe impl<T: Send> Sync for SpscRing<T> {}

impl<T: Copy + Default> SpscRing<T> {
    pub fn new(power_of_two_cap: usize) -> Self {
        let cap = power_of_two_cap.next_power_of_two().max(1024);
        Self {
            buf: UnsafeCell::new(vec![T::default(); cap]),
            mask: cap - 1,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    pub fn capacity(&self) -> usize {
        self.mask + 1
    }

    pub fn len(&self) -> usize {
        let t = self.tail.load(Ordering::Acquire);
        let h = self.head.load(Ordering::Acquire);
        t.wrapping_sub(h)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn available_write(&self) -> usize {
        self.capacity().saturating_sub(self.len() + 1)
    }

    /// Producer pushes as many samples as fit; returns number of samples pushed.
    pub fn push_slice(&self, src: &[T]) -> usize {
        let h = self.head.load(Ordering::Acquire);
        let t = self.tail.load(Ordering::Relaxed);
        let cap = self.capacity();
        let avail = cap.saturating_sub(t.wrapping_sub(h) + 1);
        let count = src.len().min(avail);
        if count == 0 {
            return 0;
        }
        let data = unsafe { &mut *self.buf.get() };
        for (i, &v) in src[..count].iter().enumerate() {
            data[(t.wrapping_add(i)) & self.mask] = v;
        }
        self.tail.store(t.wrapping_add(count), Ordering::Release);
        count
    }

    /// Consumer pops up to `dst.len()` samples; pads remaining elements with default silence on underrun.
    /// Returns number of real audio samples popped.
    pub fn pop_slice(&self, dst: &mut [T]) -> usize {
        let t = self.tail.load(Ordering::Acquire);
        let h = self.head.load(Ordering::Relaxed);
        let avail = t.wrapping_sub(h);
        let count = dst.len().min(avail);
        let data = unsafe { &*self.buf.get() };
        for i in 0..count {
            dst[i] = data[(h.wrapping_add(i)) & self.mask];
        }
        if count < dst.len() {
            dst[count..].fill(T::default());
        }
        if count > 0 {
            self.head.store(h.wrapping_add(count), Ordering::Release);
        }
        count
    }

    /// Called by consumer (or on stopped stream) to flush queued audio.
    pub fn clear(&self) {
        let t = self.tail.load(Ordering::Acquire);
        self.head.store(t, Ordering::Release);
    }
}

