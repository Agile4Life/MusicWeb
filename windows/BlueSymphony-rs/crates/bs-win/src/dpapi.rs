use std::ptr;

use windows::Win32::Foundation::{HLOCAL, LocalFree};
use windows::Win32::Security::Cryptography::{
    CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB, CryptProtectData, CryptUnprotectData,
};

use crate::WinError;

/// Encrypts sensitive bytes for the current Windows user via DPAPI.
pub fn protect(plain: &[u8]) -> Result<Vec<u8>, WinError> {
    if plain.is_empty() {
        return Ok(Vec::new());
    }

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: plain.len() as u32,
        pbData: plain.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )?;
        let result = if out_blob.pbData.is_null() || out_blob.cbData == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
        };
        if !out_blob.pbData.is_null() {
            let _ = LocalFree(Some(HLOCAL(out_blob.pbData.cast())));
        }
        Ok(result)
    }
}

/// Decrypts bytes previously encrypted with `protect` for the current Windows user.
pub fn unprotect(cipher: &[u8]) -> Result<Vec<u8>, WinError> {
    if cipher.is_empty() {
        return Ok(Vec::new());
    }

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: cipher.len() as u32,
        pbData: cipher.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &in_blob,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )?;
        let result = if out_blob.pbData.is_null() || out_blob.cbData == 0 {
            Vec::new()
        } else {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
        };
        if !out_blob.pbData.is_null() {
            let _ = LocalFree(Some(HLOCAL(out_blob.pbData.cast())));
        }
        let _ = ptr::NonNull::new(out_blob.pbData);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_round_trip() {
        let sample = b"next-auth.session-token=secret-value-12345; Path=/; Secure";
        let encrypted = protect(sample).expect("protect failed");
        assert_ne!(encrypted.as_slice(), sample);
        let decrypted = unprotect(&encrypted).expect("unprotect failed");
        assert_eq!(decrypted.as_slice(), sample);
    }

    #[test]
    fn dpapi_empty_round_trip() {
        assert!(protect(&[]).unwrap().is_empty());
        assert!(unprotect(&[]).unwrap().is_empty());
    }
}

