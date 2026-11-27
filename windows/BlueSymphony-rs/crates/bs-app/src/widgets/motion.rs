use iced::advanced::widget::{Operation, Tree, tree};
use iced::advanced::{Clipboard, Layout, Shell, Widget, layout, mouse, overlay, renderer};
use iced::{Element, Event, Length, Rectangle, Renderer, Size, Theme, Transformation, Vector};

/// Underdamped / critically damped spring for 60 FPS GPU UI motion.
#[derive(Debug, Clone, Copy)]
pub struct Spring {
    pub value: f32,
    pub velocity: f32,
    pub target: f32,
}

impl Spring {
    pub const fn settled(value: f32) -> Self {
        Self {
            value,
            velocity: 0.0,
            target: value,
        }
    }

    pub const fn from_to(start: f32, target: f32) -> Self {
        Self {
            value: start,
            velocity: 0.0,
            target,
        }
    }

    pub fn set_target(&mut self, target: f32) {
        self.target = target;
    }

    pub fn snap(&mut self, value: f32) {
        self.value = value;
        self.target = value;
        self.velocity = 0.0;
    }

    pub fn impulse(&mut self, vel: f32) {
        self.velocity += vel;
    }

    pub fn is_moving(&self) -> bool {
        (self.target - self.value).abs() > 0.0015 || self.velocity.abs() > 0.003
    }

    pub fn step(&mut self, dt: f32, stiffness: f32, damping: f32) -> bool {
        if !self.is_moving() {
            if self.value != self.target || self.velocity != 0.0 {
                self.value = self.target;
                self.velocity = 0.0;
                return true;
            }
            return false;
        }
        let clamped_dt = dt.clamp(0.001, 0.05);
        let sub_steps = if clamped_dt > 0.025 { 2 } else { 1 };
        let h = clamped_dt / sub_steps as f32;
        for _ in 0..sub_steps {
            let accel = (self.target - self.value) * stiffness - self.velocity * damping;
            self.velocity += accel * h;
            self.value += self.velocity * h;
        }
        if !self.is_moving() {
            self.value = self.target;
            self.velocity = 0.0;
        }
        true
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionOrigin {
    Center,
    LeftCenter,
    TopLeft,
}

pub struct MotionBox<'a, Message> {
    child: Element<'a, Message>,
    offset: Vector,
    scale: f32,
    origin: MotionOrigin,
    clip: bool,
}

impl<'a, Message> MotionBox<'a, Message> {
    pub fn new(
        offset: Vector,
        scale: f32,
        origin: MotionOrigin,
        clip: bool,
        child: impl Into<Element<'a, Message>>,
    ) -> Self {
        Self {
            child: child.into(),
            offset,
            scale: scale.max(0.01),
            origin,
            clip,
        }
    }

    fn is_identity(&self) -> bool {
        (self.scale - 1.0).abs() < 1e-4
            && self.offset.x.abs() < 0.05
            && self.offset.y.abs() < 0.05
    }

    fn compute_transform(&self, bounds: Rectangle) -> Transformation {
        let (ax, ay) = match self.origin {
            MotionOrigin::Center => (
                bounds.x + bounds.width * 0.5,
                bounds.y + bounds.height * 0.5,
            ),
            MotionOrigin::LeftCenter => (bounds.x, bounds.y + bounds.height * 0.5),
            MotionOrigin::TopLeft => (bounds.x, bounds.y),
        };
        Transformation::translate(self.offset.x + ax, self.offset.y + ay)
            * Transformation::scale(self.scale)
            * Transformation::translate(-ax, -ay)
    }

    fn transform_cursor(&self, cursor: mouse::Cursor, bounds: Rectangle) -> mouse::Cursor {
        if self.is_identity() {
            return cursor;
        }
        match cursor {
            mouse::Cursor::Available(pt) => {
                let inv = self.compute_transform(bounds).inverse();
                mouse::Cursor::Available(pt * inv)
            }
            other => other,
        }
    }
}

impl<'a, Message> Widget<Message, Theme, Renderer> for MotionBox<'a, Message> {
    fn size(&self) -> Size<Length> {
        self.child.as_widget().size()
    }

    fn size_hint(&self) -> Size<Length> {
        self.child.as_widget().size_hint()
    }

    fn tag(&self) -> tree::Tag {
        self.child.as_widget().tag()
    }

    fn state(&self) -> tree::State {
        self.child.as_widget().state()
    }

    fn children(&self) -> Vec<Tree> {
        self.child.as_widget().children()
    }

    fn diff(&self, tree: &mut Tree) {
        self.child.as_widget().diff(tree);
    }

    fn layout(
        &mut self,
        tree: &mut Tree,
        renderer: &Renderer,
        limits: &layout::Limits,
    ) -> layout::Node {
        self.child.as_widget_mut().layout(tree, renderer, limits)
    }

    fn operate(
        &mut self,
        tree: &mut Tree,
        layout: Layout<'_>,
        renderer: &Renderer,
        operation: &mut dyn Operation,
    ) {
        self.child
            .as_widget_mut()
            .operate(tree, layout, renderer, operation);
    }

    fn update(
        &mut self,
        tree: &mut Tree,
        event: &Event,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        renderer: &Renderer,
        clipboard: &mut dyn Clipboard,
        shell: &mut Shell<'_, Message>,
        viewport: &Rectangle,
    ) {
        let local_cursor = self.transform_cursor(cursor, layout.bounds());
        self.child.as_widget_mut().update(
            tree,
            event,
            layout,
            local_cursor,
            renderer,
            clipboard,
            shell,
            viewport,
        );
    }

    fn mouse_interaction(
        &self,
        tree: &Tree,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
        renderer: &Renderer,
    ) -> mouse::Interaction {
        let local_cursor = self.transform_cursor(cursor, layout.bounds());
        self.child
            .as_widget()
            .mouse_interaction(tree, layout, local_cursor, viewport, renderer)
    }

    fn draw(
        &self,
        tree: &Tree,
        renderer: &mut Renderer,
        theme: &Theme,
        style: &renderer::Style,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
    ) {
        use iced::advanced::Renderer as _;

        let bounds = layout.bounds();
        if self.is_identity() {
            if self.clip {
                renderer.with_layer(bounds, |r| {
                    self.child
                        .as_widget()
                        .draw(tree, r, theme, style, layout, cursor, viewport);
                });
            } else {
                self.child
                    .as_widget()
                    .draw(tree, renderer, theme, style, layout, cursor, viewport);
            }
            return;
        }

        let t = self.compute_transform(bounds);
        let local_cursor = self.transform_cursor(cursor, bounds);

        if self.clip {
            renderer.with_layer(bounds, |r| {
                r.with_transformation(t, |rt| {
                    self.child
                        .as_widget()
                        .draw(tree, rt, theme, style, layout, local_cursor, viewport);
                });
            });
        } else {
            renderer.with_transformation(t, |rt| {
                self.child
                    .as_widget()
                    .draw(tree, rt, theme, style, layout, local_cursor, viewport);
            });
        }
    }

    fn overlay<'b>(
        &'b mut self,
        tree: &'b mut Tree,
        layout: Layout<'b>,
        renderer: &Renderer,
        viewport: &Rectangle,
        translation: Vector,
    ) -> Option<overlay::Element<'b, Message, Theme, Renderer>> {
        self.child
            .as_widget_mut()
            .overlay(tree, layout, renderer, viewport, translation + self.offset)
    }
}

impl<'a, Message: 'a> From<MotionBox<'a, Message>> for Element<'a, Message> {
    fn from(w: MotionBox<'a, Message>) -> Self {
        Element::new(w)
    }
}

pub fn slide_box<'a, Message: 'a>(
    offset: Vector,
    child: impl Into<Element<'a, Message>>,
) -> Element<'a, Message> {
    MotionBox::new(offset, 1.0, MotionOrigin::TopLeft, false, child).into()
}

pub fn scale_box<'a, Message: 'a>(
    scale: f32,
    origin: MotionOrigin,
    child: impl Into<Element<'a, Message>>,
) -> Element<'a, Message> {
    MotionBox::new(Vector::ZERO, scale, origin, false, child).into()
}

pub fn motion_box<'a, Message: 'a>(
    offset: Vector,
    scale: f32,
    origin: MotionOrigin,
    clip: bool,
    child: impl Into<Element<'a, Message>>,
) -> Element<'a, Message> {
    MotionBox::new(offset, scale, origin, clip, child).into()
}

#[derive(Default)]
struct HoverState {
    hovered: bool,
}

pub struct HoverReveal<'a, Message> {
    base: Element<'a, Message>,
    overlay: Element<'a, Message>,
}

impl<'a, Message> HoverReveal<'a, Message> {
    pub fn new(
        base: impl Into<Element<'a, Message>>,
        overlay: impl Into<Element<'a, Message>>,
    ) -> Self {
        Self {
            base: base.into(),
            overlay: overlay.into(),
        }
    }
}

impl<'a, Message> Widget<Message, Theme, Renderer> for HoverReveal<'a, Message> {
    fn size(&self) -> Size<Length> {
        self.base.as_widget().size()
    }

    fn size_hint(&self) -> Size<Length> {
        self.base.as_widget().size_hint()
    }

    fn tag(&self) -> tree::Tag {
        tree::Tag::of::<HoverState>()
    }

    fn state(&self) -> tree::State {
        tree::State::new(HoverState::default())
    }

    fn children(&self) -> Vec<Tree> {
        vec![Tree::new(&self.base), Tree::new(&self.overlay)]
    }

    fn diff(&self, tree: &mut Tree) {
        tree.diff_children(&[&self.base, &self.overlay]);
    }

    fn layout(
        &mut self,
        tree: &mut Tree,
        renderer: &Renderer,
        limits: &layout::Limits,
    ) -> layout::Node {
        let base_node = self
            .base
            .as_widget_mut()
            .layout(&mut tree.children[0], renderer, limits);
        let size = base_node.size();
        let overlay_node = self.overlay.as_widget_mut().layout(
            &mut tree.children[1],
            renderer,
            &layout::Limits::new(Size::ZERO, size),
        );
        layout::Node::with_children(size, vec![base_node, overlay_node])
    }

    fn operate(
        &mut self,
        tree: &mut Tree,
        layout: Layout<'_>,
        renderer: &Renderer,
        operation: &mut dyn Operation,
    ) {
        if let Some(base_layout) = layout.children().next() {
            self.base
                .as_widget_mut()
                .operate(&mut tree.children[0], base_layout, renderer, operation);
        }
    }

    fn update(
        &mut self,
        tree: &mut Tree,
        event: &Event,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        renderer: &Renderer,
        clipboard: &mut dyn Clipboard,
        shell: &mut Shell<'_, Message>,
        viewport: &Rectangle,
    ) {
        let now_hovered = cursor.is_over(layout.bounds());
        let st = tree.state.downcast_mut::<HoverState>();
        if st.hovered != now_hovered {
            st.hovered = now_hovered;
            shell.request_redraw();
        }
        if let Some(base_layout) = layout.children().next() {
            self.base.as_widget_mut().update(
                &mut tree.children[0],
                event,
                base_layout,
                cursor,
                renderer,
                clipboard,
                shell,
                viewport,
            );
        }
    }

    fn mouse_interaction(
        &self,
        tree: &Tree,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
        renderer: &Renderer,
    ) -> mouse::Interaction {
        if let Some(base_layout) = layout.children().next() {
            self.base.as_widget().mouse_interaction(
                &tree.children[0],
                base_layout,
                cursor,
                viewport,
                renderer,
            )
        } else {
            mouse::Interaction::default()
        }
    }

    fn draw(
        &self,
        tree: &Tree,
        renderer: &mut Renderer,
        theme: &Theme,
        style: &renderer::Style,
        layout: Layout<'_>,
        cursor: mouse::Cursor,
        viewport: &Rectangle,
    ) {
        let mut children = layout.children();
        if let Some(base_layout) = children.next() {
            self.base.as_widget().draw(
                &tree.children[0],
                renderer,
                theme,
                style,
                base_layout,
                cursor,
                viewport,
            );
        }
        if cursor.is_over(layout.bounds()) {
            if let Some(overlay_layout) = children.next() {
                self.overlay.as_widget().draw(
                    &tree.children[1],
                    renderer,
                    theme,
                    style,
                    overlay_layout,
                    cursor,
                    viewport,
                );
            }
        }
    }

    fn overlay<'b>(
        &'b mut self,
        tree: &'b mut Tree,
        layout: Layout<'b>,
        renderer: &Renderer,
        viewport: &Rectangle,
        translation: Vector,
    ) -> Option<overlay::Element<'b, Message, Theme, Renderer>> {
        let base_layout = layout.children().next()?;
        self.base.as_widget_mut().overlay(
            &mut tree.children[0],
            base_layout,
            renderer,
            viewport,
            translation,
        )
    }
}

impl<'a, Message: 'a> From<HoverReveal<'a, Message>> for Element<'a, Message> {
    fn from(w: HoverReveal<'a, Message>) -> Self {
        Element::new(w)
    }
}

pub fn hover_reveal<'a, Message: 'a>(
    base: impl Into<Element<'a, Message>>,
    overlay: impl Into<Element<'a, Message>>,
) -> Element<'a, Message> {
    HoverReveal::new(base, overlay).into()
}

