use iced::widget::scrollable::Direction;
use iced::widget::{button, column, container, row, scrollable, space, text};
use iced::{Alignment, Background, Border, Color, Element, Length, Vector};

use crate::icons;
use crate::state::{AppState, Message};
use crate::theme::{
    FONT_BOLD, FONT_SEMIBOLD, Palette, apple_v_scrollbar, ghost_button, glass_card,
    sidebar_surface, subtle_scrollable, truncate_str,
};
use crate::widgets::artwork::artwork;
use crate::widgets::micro::{eq_bars, hairline_divider, vertical_hairline};
use crate::widgets::motion::{MotionOrigin, motion_box};

pub fn view_animated<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    view_animated_inner(state, p, false)
}

pub fn view_animated_immersive<'a>(state: &'a AppState, p: Palette) -> Element<'a, Message> {
    view_animated_inner(state, p, true)
}

fn view_animated_inner<'a>(
    state: &'a AppState,
    p: Palette,
    immersive: bool,
) -> Element<'a, Message> {
    let q_t = state.queue_spring.value.clamp(0.0, 1.0);
    let w = (340.0 * q_t).max(1.0);
    let slide_x = (1.0 - q_t) * 120.0;
    container(motion_box(
        Vector::new(slide_x, 0.0),
        1.0,
        MotionOrigin::TopLeft,
        true,
        view_inner(state, p, immersive),
    ))
    .width(w)
    .height(Length::Fill)
    .into()
}

fn view_inner<'a>(state: &'a AppState, p: Palette, immersive: bool) -> Element<'a, Message> {
    let snap = &state.player;
    let title_main = if immersive { Color::WHITE } else { p.text };
    let text_sub = if immersive {
        Color::from_rgba(1.0, 1.0, 1.0, 0.62)
    } else {
        p.text_muted
    };
    let text_subtle = if immersive {
        Color::from_rgba(1.0, 1.0, 1.0, 0.48)
    } else {
        p.text_dim
    };
    let active_tint = if immersive { Color::WHITE } else { p.accent };

    let header = row![
        column![
            text("Tiếp theo").size(17).font(FONT_BOLD).color(title_main),
            text(format!("{} bài hát", snap.queue.len()))
                .size(12)
                .color(text_sub),
        ]
        .spacing(2),
        space().width(Length::Fill),
        button(icons::close(16.0, text_sub))
            .padding(6)
            .style(ghost_button(p, 7.0))
            .on_press(Message::ToggleQueueDrawer),
    ]
    .align_y(Alignment::Center)
    .width(Length::Fill);

    let mut list = column![].spacing(2).width(Length::Fill);

    if snap.queue.is_empty() {
        list = list.push(
            container(
                text("Hàng chờ trống. Phát một bài hát để bắt đầu.")
                    .size(13)
                    .color(text_sub),
            )
            .padding(20)
            .width(Length::Fill)
            .style(glass_card(p, 12.0)),
        );
    } else {
        for (i, tr) in snap.queue.iter().enumerate() {
            let is_cur = i == snap.index;
            if is_cur {
                list = list.push(
                    container(
                        text("ĐANG PHÁT")
                            .size(10.5)
                            .font(FONT_SEMIBOLD)
                            .color(active_tint),
                    )
                    .padding([4, 6]),
                );
            } else if i == snap.index + 1 {
                list = list.push(
                    container(
                        text("TIẾP THEO")
                            .size(10.5)
                            .font(FONT_SEMIBOLD)
                            .color(text_subtle),
                    )
                    .padding([8, 6]),
                );
            }

            let title_col = if is_cur { active_tint } else { title_main };

            let mut row_items = row![
                button(
                    row![
                        if is_cur {
                            Element::from(
                                container(eq_bars(
                                    state.aurora_time,
                                    snap.is_playing,
                                    active_tint,
                                    14.0,
                                    12.0,
                                ))
                                .width(18)
                                .align_x(Alignment::Center),
                            )
                        } else {
                            Element::from(space().width(0))
                        },
                        artwork(&state.image_cache, tr.cover_url.as_deref(), 40.0, 5.0, p),
                        column![
                            text(truncate_str(&tr.title, 24))
                                .size(13)
                                .font(FONT_SEMIBOLD)
                                .color(title_col),
                            text(truncate_str(tr.artist_name(), 24))
                                .size(11.5)
                                .color(text_sub),
                        ]
                        .spacing(2)
                        .width(Length::Fill),
                    ]
                    .spacing(10)
                    .align_y(Alignment::Center),
                )
                .padding([5, 6])
                .width(Length::Fill)
                .style(ghost_button(p, 7.0))
                .on_press(Message::JumpQueue(i)),
            ]
            .spacing(2)
            .align_y(Alignment::Center);

            if !is_cur {
                if i > 0 {
                    row_items = row_items.push(
                        button(icons::chevron_up(13.0, text_subtle))
                            .padding(4)
                            .style(ghost_button(p, 6.0))
                            .on_press(Message::MoveQueueItem { from: i, to: i - 1 }),
                    );
                }
                if i + 1 < snap.queue.len() {
                    row_items = row_items.push(
                        button(icons::chevron_down(13.0, text_subtle))
                            .padding(4)
                            .style(ghost_button(p, 6.0))
                            .on_press(Message::MoveQueueItem { from: i, to: i + 1 }),
                    );
                }
                row_items = row_items.push(
                    button(icons::close(13.0, text_subtle))
                        .padding(4)
                        .style(ghost_button(p, 6.0))
                        .on_press(Message::RemoveFromQueue(i)),
                );
            }

            let cur_bg = if immersive { 0.14 } else { 0.08 };
            list = list.push(
                container(row_items)
                    .padding([1, 2])
                    .width(Length::Fill)
                    .style(move |_| container::Style {
                        background: Some(Background::Color(if is_cur {
                            Color::from_rgba(1.0, 1.0, 1.0, cur_bg)
                        } else {
                            Color::TRANSPARENT
                        })),
                        border: Border {
                            width: 0.0,
                            radius: 7.0.into(),
                            ..Default::default()
                        },
                        ..Default::default()
                    }),
            );
        }
    }

    if snap.is_fetching_more {
        list = list.push(
            container(text("Đang tự động tìm bài tiếp theo…").size(12).color(active_tint))
                .padding(10)
                .width(Length::Fill),
        );
    }

    let divider: Element<'a, Message> = if immersive {
        container(space().width(Length::Fill).height(1))
            .style(|_| container::Style {
                background: Some(Background::Color(Color::from_rgba(1.0, 1.0, 1.0, 0.10))),
                ..Default::default()
            })
            .into()
    } else {
        hairline_divider(p)
    };

    let content_col = column![
        header,
        divider,
        scrollable(list)
            .direction(Direction::Vertical(apple_v_scrollbar()))
            .style(subtle_scrollable(p))
            .width(Length::Fill)
            .height(Length::Fill),
    ]
    .spacing(10)
    .width(Length::Fill)
    .height(Length::Fill);

    if immersive {
        container(content_col)
            .width(340)
            .height(Length::Fill)
            .padding(16)
            .style(|_| container::Style {
                background: Some(Background::Color(Color::from_rgba8(14, 14, 18, 0.34))),
                border: Border {
                    color: Color::from_rgba(1.0, 1.0, 1.0, 0.11),
                    width: 1.0,
                    radius: 14.0.into(),
                },
                ..Default::default()
            })
            .into()
    } else {
        let drawer_body = container(content_col)
            .width(Length::Fill)
            .height(Length::Fill)
            .padding(16)
            .style(sidebar_surface(p));

        row![vertical_hairline(p), drawer_body]
            .width(340)
            .height(Length::Fill)
            .into()
    }
}
