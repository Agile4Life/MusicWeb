use iced::widget::scrollable::Direction;
use iced::widget::{button, column, container, mouse_area, row, scrollable, space, text, text_input, toggler};
use iced::{Alignment, Background, Color, Element, Length};

use bs_core::models::Track;

use crate::icons;
use crate::state::{AppState, Message, PlaylistEditorMode, PlaylistEditorState};
use crate::theme::{
    Palette, apple_v_scrollbar, elevated_panel, ghost_button, glass_input, primary_button,
    subtle_scrollable,
};

pub fn editor_modal<'a>(editor: &'a PlaylistEditorState, p: Palette) -> Element<'a, Message> {
    let is_edit = matches!(editor.mode, PlaylistEditorMode::Edit { .. });

    let mut form = column![
        row![
            text(if is_edit {
                "Chỉnh sửa Playlist"
            } else {
                "Tạo Playlist mới"
            })
            .size(19)
            .color(p.text),
            space().width(Length::Fill),
            button(icons::close(16.0, p.text_muted))
                .padding(6)
                .style(ghost_button(p, 8.0))
                .on_press(Message::ClosePlaylistEditor),
        ]
        .align_y(Alignment::Center),
        column![
            text("Tên playlist").size(12).color(p.text_muted),
            text_input("VD: Nhạc Chill Cuối Tuần", &editor.name)
                .on_input(Message::PlaylistEditorNameChanged)
                .on_submit(Message::SavePlaylistEditor)
                .padding([10, 12])
                .size(14)
                .style(glass_input(p)),
        ]
        .spacing(6),
        column![
            text("Mô tả").size(12).color(p.text_muted),
            text_input("Mô tả ngắn (tuỳ chọn)", &editor.description)
                .on_input(Message::PlaylistEditorDescChanged)
                .padding([10, 12])
                .size(14)
                .style(glass_input(p)),
        ]
        .spacing(6),
        row![
            text("Công khai playlist").size(14).color(p.text),
            space().width(Length::Fill),
            toggler(editor.is_public).on_toggle(Message::PlaylistEditorPublicToggled),
        ]
        .align_y(Alignment::Center),
    ]
    .spacing(14);

    if let Some(ref err) = editor.error {
        form = form.push(text(err.clone()).size(13).color(p.danger));
    }

    let can_save = !editor.loading && !editor.name.trim().is_empty();
    form = form.push(
        row![
            space().width(Length::Fill),
            button(text("Huỷ").size(13).color(p.text_muted))
                .padding([9, 16])
                .style(ghost_button(p, 999.0))
                .on_press(Message::ClosePlaylistEditor),
            button(
                text(if editor.loading { "Đang lưu…" } else { "Lưu" })
                    .size(14)
                    .color(p.accent_fg),
            )
            .padding([9, 22])
            .style(primary_button(p, 999.0))
            .on_press_maybe(can_save.then_some(Message::SavePlaylistEditor)),
        ]
        .spacing(10),
    );

    let dialog = mouse_area(
        container(form)
            .width(420)
            .padding(24)
            .style(elevated_panel(p, 18.0)),
    )
    .on_press(Message::SystemTick);

    mouse_area(
        container(dialog)
            .width(Length::Fill)
            .height(Length::Fill)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .style(|_| container::Style {
                background: Some(Background::Color(Color::from_rgba(0.0, 0.0, 0.0, 0.65))),
                ..Default::default()
            }),
    )
    .on_press(Message::ClosePlaylistEditor)
    .into()
}

pub fn picker_modal<'a>(state: &'a AppState, track: &'a Track, p: Palette) -> Element<'a, Message> {
    let owned_playlists: Vec<_> = state
        .playlists
        .iter()
        .filter(|pl| state.session_snap.owns(pl))
        .collect();

    let mut body = column![
        row![
            column![
                text("Thêm vào Playlist").size(18).color(p.text),
                text(track.title.clone()).size(12).color(p.text_muted),
            ]
            .spacing(2),
            space().width(Length::Fill),
            button(icons::close(16.0, p.text_muted))
                .padding(6)
                .style(ghost_button(p, 8.0))
                .on_press(Message::ClosePlaylistPicker),
        ]
        .align_y(Alignment::Center),
    ]
    .spacing(14);

    if !state.session_snap.is_signed_in() {
        body = body.push(
            text("Vui lòng đăng nhập để thêm bài hát vào playlist.")
                .size(13)
                .color(p.text_muted),
        );
    } else if owned_playlists.is_empty() {
        body = body.push(
            column![
                text("Bạn chưa có playlist cá nhân nào.")
                    .size(13)
                    .color(p.text_muted),
                button(
                    text("Tạo playlist mới")
                        .size(13)
                        .color(p.accent_fg),
                )
                .padding([9, 18])
                .style(primary_button(p, 999.0))
                .on_press(Message::OpenCreatePlaylist),
            ]
            .spacing(10),
        );
    } else {
        let mut list = column![].spacing(6);
        for pl in owned_playlists {
            list = list.push(
                button(
                    row![
                        icons::list_music(16.0, p.accent),
                        text(pl.name.clone()).size(14).color(p.text),
                    ]
                    .spacing(10)
                    .align_y(Alignment::Center),
                )
                .width(Length::Fill)
                .padding([10, 14])
                .style(ghost_button(p, 10.0))
                .on_press(Message::AddTrackToPlaylist {
                    playlist_id: pl.id.clone(),
                    track: track.clone(),
                }),
            );
        }
        body = body.push(
            scrollable(list)
                .direction(Direction::Vertical(apple_v_scrollbar()))
                .style(subtle_scrollable(p))
                .height(Length::Fixed(240.0)),
        );
    }

    let dialog = mouse_area(
        container(body)
            .width(380)
            .padding(22)
            .style(elevated_panel(p, 18.0)),
    )
    .on_press(Message::SystemTick);

    mouse_area(
        container(dialog)
            .width(Length::Fill)
            .height(Length::Fill)
            .align_x(Alignment::Center)
            .align_y(Alignment::Center)
            .style(|_| container::Style {
                background: Some(Background::Color(Color::from_rgba(0.0, 0.0, 0.0, 0.65))),
                ..Default::default()
            }),
    )
    .on_press(Message::ClosePlaylistPicker)
    .into()
}

