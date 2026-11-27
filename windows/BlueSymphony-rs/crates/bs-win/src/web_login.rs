use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Once;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2_2,
    ICoreWebView2Controller, ICoreWebView2CookieList, ICoreWebView2CookieManager,
    ICoreWebView2Environment,
};
use webview2_com::{
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    GetCookiesCompletedHandler, take_pwstr,
};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{BLACK_BRUSH, GetStockObject, HBRUSH};
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CW_USEDEFAULT, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    GWLP_USERDATA, GetClientRect, GetMessageW, GetSystemMetrics, GetWindowLongPtrW, IDC_ARROW,
    KillTimer, LoadCursorW, MSG, PostQuitMessage, RegisterClassW, SM_CXSCREEN, SM_CYSCREEN,
    SetTimer, SetWindowLongPtrW, TranslateMessage, WINDOW_EX_STYLE, WM_CLOSE, WM_DESTROY,
    WM_SIZE, WM_TIMER, WNDCLASSW, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};
use windows::core::{BOOL, HSTRING, Interface, PWSTR, w};

use crate::WinError;
use crate::dwm::{BackdropKind, apply_window_style};

const TIMER_POLL_COOKIES: usize = 1;
const WINDOW_WIDTH: i32 = 520;
const WINDOW_HEIGHT: i32 = 740;

static REGISTER_CLASS: Once = Once::new();

#[derive(Debug, Clone)]
pub struct WebCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub is_secure: bool,
    pub is_http_only: bool,
}

struct WindowState {
    hwnd: HWND,
    login_url: String,
    cookie_origin: String,
    controller: Option<ICoreWebView2Controller>,
    webview: Option<ICoreWebView2>,
    cookie_manager: Option<ICoreWebView2CookieManager>,
    captured: Option<Vec<WebCookie>>,
    polling: bool,
}

/// Opens a native Microsoft Edge WebView2 window at `login_url`, lets the user sign in
/// (supporting Google OAuth, credentials, SSO, etc.), and returns the extracted cookies once
/// a valid NextAuth session cookie is present on `cookie_origin`.
/// Returns an empty `Vec` if the user closes the window before finishing sign-in.
pub fn open_web_login(
    login_url: String,
    cookie_origin: String,
    user_data_dir: PathBuf,
) -> Result<Vec<WebCookie>, WinError> {
    let _ = std::fs::create_dir_all(&user_data_dir);

    unsafe {
        let com_hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let com_ok = com_hr.is_ok();

        let hinstance = GetModuleHandleW(None)?;
        let class_name = w!("BlueSymphonyWebLoginWindow");

        REGISTER_CLASS.call_once(|| {
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: hinstance.into(),
                lpszClassName: class_name,
                hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
                hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
                ..Default::default()
            };
            let _ = RegisterClassW(&wc);
        });

        let screen_w = GetSystemMetrics(SM_CXSCREEN);
        let screen_h = GetSystemMetrics(SM_CYSCREEN);
        let x = if screen_w > WINDOW_WIDTH {
            (screen_w - WINDOW_WIDTH) / 2
        } else {
            CW_USEDEFAULT
        };
        let y = if screen_h > WINDOW_HEIGHT {
            (screen_h - WINDOW_HEIGHT) / 2
        } else {
            CW_USEDEFAULT
        };

        let title = w!("Đăng nhập — BlueSymphony");
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            title,
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            x,
            y,
            WINDOW_WIDTH,
            WINDOW_HEIGHT,
            None,
            None,
            Some(hinstance.into()),
            None,
        )?;

        apply_window_style(hwnd.0 as isize, true, BackdropKind::Mica);

        let state = Rc::new(RefCell::new(WindowState {
            hwnd,
            login_url,
            cookie_origin,
            controller: None,
            webview: None,
            cookie_manager: None,
            captured: None,
            polling: false,
        }));

        let raw_ptr = Rc::into_raw(Rc::clone(&state));
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, raw_ptr as isize);

        if let Err(err) = init_webview2(Rc::clone(&state), &user_data_dir) {
            let _ = DestroyWindow(hwnd);
            let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            drop(Rc::from_raw(raw_ptr));
            if com_ok {
                CoUninitialize();
            }
            return Err(err);
        }

        let _ = SetTimer(Some(hwnd), TIMER_POLL_COOKIES, 650, None);

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }

        let _ = KillTimer(Some(hwnd), TIMER_POLL_COOKIES);
        let result = state.borrow_mut().captured.take().unwrap_or_default();

        // Balance the raw pointer kept in GWLP_USERDATA if WM_DESTROY didn't clear it.
        if GetWindowLongPtrW(hwnd, GWLP_USERDATA) != 0 {
            let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            drop(Rc::from_raw(raw_ptr));
        }

        if com_ok {
            CoUninitialize();
        }

        Ok(result)
    }
}

unsafe fn init_webview2(
    state: Rc<RefCell<WindowState>>,
    user_data_dir: &std::path::Path,
) -> Result<(), WinError> {
    let data_w = HSTRING::from(user_data_dir.as_os_str());

    let handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
        move |err, env: Option<ICoreWebView2Environment>| {
            if let Err(e) = err {
                tracing::error!("WebView2 env creation failed: {e}");
                let hwnd = state.borrow().hwnd;
                unsafe {
                    let _ = DestroyWindow(hwnd);
                }
                return Ok(());
            }
            let Some(env) = env else {
                return Ok(());
            };

            let hwnd = state.borrow().hwnd;
            let state_ctl = Rc::clone(&state);
            let ctl_handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
                move |err, controller: Option<ICoreWebView2Controller>| {
                    if let Err(e) = err {
                        tracing::error!("WebView2 controller creation failed: {e}");
                        let hwnd = state_ctl.borrow().hwnd;
                        unsafe {
                            let _ = DestroyWindow(hwnd);
                        }
                        return Ok(());
                    }
                    let Some(controller) = controller else {
                        return Ok(());
                    };

                    unsafe {
                        let mut rect = RECT::default();
                        let _ = GetClientRect(hwnd, &mut rect);
                        let _ = controller.SetBounds(rect);

                        if let Ok(webview) = controller.CoreWebView2() {
                            let cookie_mgr = webview
                                .cast::<ICoreWebView2_2>()
                                .ok()
                                .and_then(|w2| w2.CookieManager().ok());

                            let (login_url, cookie_origin) = {
                                let mut s = state_ctl.borrow_mut();
                                s.controller = Some(controller);
                                s.webview = Some(webview.clone());
                                s.cookie_manager = cookie_mgr.clone();
                                (s.login_url.clone(), s.cookie_origin.clone())
                            };

                            if let Some(mgr) = cookie_mgr {
                                clear_stale_nextauth_then_navigate(
                                    mgr,
                                    webview,
                                    cookie_origin,
                                    login_url,
                                );
                            } else {
                                let _ = webview.Navigate(&HSTRING::from(login_url));
                            }
                        }
                    }
                    Ok(())
                },
            ));

            unsafe {
                if let Err(e) = env.CreateCoreWebView2Controller(hwnd, &ctl_handler) {
                    tracing::error!("CreateCoreWebView2Controller failed: {e}");
                    let _ = DestroyWindow(hwnd);
                }
            }
            Ok(())
        },
    ));

    unsafe {
        CreateCoreWebView2EnvironmentWithOptions(None, &data_w, None, &handler)
            .map_err(|e| WinError::WebLogin(format!("Không thể mở Microsoft Edge WebView2: {e}")))
    }
}

unsafe fn clear_stale_nextauth_then_navigate(
    mgr: ICoreWebView2CookieManager,
    webview: ICoreWebView2,
    cookie_origin: String,
    login_url: String,
) {
    let origin_w = HSTRING::from(cookie_origin);
    let mgr_clone = mgr.clone();
    let handler = GetCookiesCompletedHandler::create(Box::new(
        move |_err, list: Option<ICoreWebView2CookieList>| {
            if let Some(list) = list {
                unsafe {
                    let mut count = 0u32;
                    if list.Count(&mut count).is_ok() {
                        for i in 0..count {
                            if let Ok(cookie) = list.GetValueAtIndex(i) {
                                let mut name_pw = PWSTR::null();
                                if cookie.Name(&mut name_pw).is_ok() {
                                    let name = take_pwstr(name_pw);
                                    if name.contains("next-auth") {
                                        let _ = mgr_clone.DeleteCookie(&cookie);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            unsafe {
                let _ = webview.Navigate(&HSTRING::from(login_url.clone()));
            }
            Ok(())
        },
    ));

    unsafe {
        if mgr.GetCookies(&origin_w, &handler).is_err() {
            let _ = mgr.DeleteAllCookies();
        }
    }
}

unsafe fn poll_session_cookies(state: Rc<RefCell<WindowState>>) {
    let (mgr, webview, origin, hwnd) = {
        let mut s = state.borrow_mut();
        if s.polling || s.captured.is_some() {
            return;
        }
        let (Some(mgr), Some(webview)) = (s.cookie_manager.clone(), s.webview.clone()) else {
            return;
        };
        s.polling = true;
        (mgr, webview, s.cookie_origin.clone(), s.hwnd)
    };

    // Only capture once the browser has finished redirecting away from `/login`
    let mut src_pw = PWSTR::null();
    let current_url = unsafe {
        if webview.Source(&mut src_pw).is_ok() {
            take_pwstr(src_pw)
        } else {
            String::new()
        }
    };
    let settled_on_app =
        current_url.starts_with(&origin) && !current_url.contains("/login");
    if !settled_on_app {
        state.borrow_mut().polling = false;
        return;
    }

    let origin_w = HSTRING::from(origin);
    let state_cb = Rc::clone(&state);
    let handler = GetCookiesCompletedHandler::create(Box::new(
        move |err, list: Option<ICoreWebView2CookieList>| {
            if err.is_err() {
                state_cb.borrow_mut().polling = false;
                return Ok(());
            }

            let cookies = list.map(|l| unsafe { read_cookie_list(&l) }).unwrap_or_default();
            let has_session = cookies.iter().any(|c| {
                !c.value.is_empty()
                    && (c.name == "__Secure-next-auth.session-token"
                        || c.name == "next-auth.session-token"
                        || c.name.starts_with("__Secure-next-auth.session-token.")
                        || c.name.starts_with("next-auth.session-token."))
            });

            if has_session {
                let ctl = {
                    let mut s = state_cb.borrow_mut();
                    s.captured = Some(cookies);
                    s.polling = false;
                    s.controller.take()
                };
                unsafe {
                    let _ = KillTimer(Some(hwnd), TIMER_POLL_COOKIES);
                    if let Some(c) = ctl {
                        let _ = c.Close();
                    }
                    let _ = DestroyWindow(hwnd);
                }
            } else {
                state_cb.borrow_mut().polling = false;
            }
            Ok(())
        },
    ));

    unsafe {
        if mgr.GetCookies(&origin_w, &handler).is_err() {
            state.borrow_mut().polling = false;
        }
    }
}

unsafe fn read_cookie_list(list: &ICoreWebView2CookieList) -> Vec<WebCookie> {
    let mut out = Vec::new();
    let mut count = 0u32;
    unsafe {
        if list.Count(&mut count).is_err() {
            return out;
        }
        for i in 0..count {
            let Ok(c) = list.GetValueAtIndex(i) else {
                continue;
            };
            let mut name_pw = PWSTR::null();
            let mut val_pw = PWSTR::null();
            let mut dom_pw = PWSTR::null();
            let mut path_pw = PWSTR::null();
            let mut secure = BOOL(0);
            let mut http_only = BOOL(0);

            if c.Name(&mut name_pw).is_err() || c.Value(&mut val_pw).is_err() {
                continue;
            }
            let name = take_pwstr(name_pw);
            let value = take_pwstr(val_pw);
            let domain = if c.Domain(&mut dom_pw).is_ok() {
                take_pwstr(dom_pw)
            } else {
                String::new()
            };
            let path = if c.Path(&mut path_pw).is_ok() {
                take_pwstr(path_pw)
            } else {
                "/".to_string()
            };
            let _ = c.IsSecure(&mut secure);
            let _ = c.IsHttpOnly(&mut http_only);

            out.push(WebCookie {
                name,
                value,
                domain,
                path,
                is_secure: secure.as_bool(),
                is_http_only: http_only.as_bool(),
            });
        }
    }
    out
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const RefCell<WindowState>;
        if !ptr.is_null() {
            // Borrow temporarily via a cloned Rc without taking ownership until WM_DESTROY.
            Rc::increment_strong_count(ptr);
            let state = Rc::from_raw(ptr);

            match msg {
                WM_SIZE => {
                    let mut rect = RECT::default();
                    let _ = GetClientRect(hwnd, &mut rect);
                    if let Some(ref ctl) = state.borrow().controller {
                        let _ = ctl.SetBounds(rect);
                    }
                    return LRESULT(0);
                }
                WM_TIMER if wparam.0 == TIMER_POLL_COOKIES => {
                    poll_session_cookies(Rc::clone(&state));
                    return LRESULT(0);
                }
                WM_CLOSE => {
                    let ctl = state.borrow_mut().controller.take();
                    if let Some(c) = ctl {
                        let _ = c.Close();
                    }
                    let _ = DestroyWindow(hwnd);
                    return LRESULT(0);
                }
                WM_DESTROY => {
                    let _ = KillTimer(Some(hwnd), TIMER_POLL_COOKIES);
                    let ctl = state.borrow_mut().controller.take();
                    if let Some(c) = ctl {
                        let _ = c.Close();
                    }
                    let _ = SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                    drop(state);
                    // Drop the original leaked Rc stored in GWLP_USERDATA.
                    drop(Rc::from_raw(ptr));
                    PostQuitMessage(0);
                    return LRESULT(0);
                }
                _ => {}
            }
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}
