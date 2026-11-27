use serde::{Deserialize, Serialize};

use crate::api::ApiClient;
use crate::config::AppConfig;
use crate::error::{ApiError, AuthError};

#[derive(Debug, Clone, Default)]
pub struct SessionInfo {
    pub email: Option<String>,
    pub user_id: Option<String>,
}

/// Mirrors `ios/BlueSymphony/Core/AuthService.swift` & `components/auth/AuthForm.tsx`:
/// Supabase password grant -> NextAuth credentials callback -> session cookie persisted via DPAPI.
pub struct AuthService;

impl AuthService {
    /// Plain usernames become `<username>@musicweb.com`, matching web & iOS.
    pub fn auth_email(account: &str) -> String {
        let trimmed = account.trim().to_ascii_lowercase();
        if trimmed.contains('@') {
            trimmed
        } else {
            format!("{trimmed}@musicweb.com")
        }
    }

    pub async fn sign_in(
        api: &ApiClient,
        config: &AppConfig,
        account: &str,
        password: &str,
    ) -> Result<SessionInfo, AuthError> {
        let email = Self::auth_email(account);
        let token = Self::supabase_token(api, config, &email, password, true).await?;
        Self::create_session(api, &email, &token).await?;
        api.persist_cookies();
        Ok(Self::session_info(api).await)
    }

    pub async fn register(
        api: &ApiClient,
        config: &AppConfig,
        username: &str,
        password: &str,
        real_email: &str,
    ) -> Result<SessionInfo, AuthError> {
        #[derive(Serialize)]
        struct Body<'a> {
            username: &'a str,
            password: &'a str,
            #[serde(rename = "realEmail", skip_serializing_if = "Option::is_none")]
            real_email: Option<&'a str>,
        }
        #[derive(Deserialize)]
        struct Reply {
            ok: Option<bool>,
            #[serde(rename = "authEmail")]
            auth_email: Option<String>,
            error: Option<String>,
        }

        let name = username.trim();
        let mail = real_email.trim();
        let body = Body {
            username: name,
            password,
            real_email: if mail.is_empty() { None } else { Some(mail) },
        };

        let reply: Reply = match api.post_json("api/register", &body).await {
            Ok(r) => r,
            Err(ApiError::Server(msg)) => {
                return Err(AuthError(
                    msg.unwrap_or_else(|| "Đăng ký thất bại. Vui lòng thử lại!".to_string()),
                ));
            }
            Err(e) => return Err(AuthError(e.to_string())),
        };

        if reply.ok != Some(true) {
            return Err(AuthError(
                reply
                    .error
                    .unwrap_or_else(|| "Đăng ký thất bại. Vui lòng thử lại!".to_string()),
            ));
        }

        let Some(auth_email) = reply.auth_email else {
            return Err(AuthError("Đăng ký thất bại. Vui lòng thử lại!".to_string()));
        };

        let token = Self::supabase_token(api, config, &auth_email, password, true).await?;
        Self::create_session(api, &auth_email, &token).await?;
        api.persist_cookies();
        Ok(Self::session_info(api).await)
    }

    pub async fn session_info(api: &ApiClient) -> SessionInfo {
        #[derive(Deserialize)]
        struct User {
            email: Option<String>,
            id: Option<String>,
        }
        #[derive(Deserialize)]
        struct SessionReply {
            user: Option<User>,
        }

        match api.get_json::<SessionReply>("api/auth/session", &[]).await {
            Ok(s) => SessionInfo {
                email: s.user.as_ref().and_then(|u| u.email.clone()),
                user_id: s.user.as_ref().and_then(|u| u.id.clone()),
            },
            Err(_) => SessionInfo::default(),
        }
    }

    pub async fn sign_out(api: &ApiClient) {
        if let Ok(csrf) = Self::csrf_token(api).await {
            let _ = api
                .post_form("api/auth/signout", &[("csrfToken", &csrf), ("json", "true")])
                .await;
        }
        api.clear_cookies();
    }

    async fn supabase_token(
        api: &ApiClient,
        config: &AppConfig,
        email: &str,
        password: &str,
        retry_confirm: bool,
    ) -> Result<String, AuthError> {
        let (Some(base), Some(key)) = (&config.supabase_url, &config.supabase_anon_key) else {
            return Err(AuthError(
                "Ứng dụng chưa cấu hình đăng nhập (chưa cấu hình Supabase).".to_string(),
            ));
        };

        #[derive(Deserialize)]
        struct Reply {
            access_token: Option<String>,
            error_code: Option<String>,
            msg: Option<String>,
            error_description: Option<String>,
            message: Option<String>,
        }

        let url = format!("{base}/auth/v1/token?grant_type=password");
        let res = api
            .http()
            .post(&url)
            .header("apikey", key)
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await
            .map_err(|_| {
                AuthError("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.".to_string())
            })?;

        let bytes = res.bytes().await.map_err(|_| {
            AuthError("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.".to_string())
        })?;
        let parsed = serde_json::from_slice::<Reply>(&bytes).ok();

        if let Some(token) = parsed.as_ref().and_then(|r| r.access_token.clone()) {
            return Ok(token);
        }

        let joined = parsed
            .map(|r| {
                [r.error_code, r.msg, r.error_description, r.message]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_ascii_lowercase()
            })
            .unwrap_or_default();

        if joined.contains("not confirmed") && retry_confirm {
            let _ = api
                .post_void("api/approve-email", &serde_json::json!({ "email": email }))
                .await;
            return Box::pin(Self::supabase_token(api, config, email, password, false)).await;
        }

        Err(AuthError(translate_supabase_error(&joined).to_string()))
    }

    async fn create_session(
        api: &ApiClient,
        email: &str,
        access_token: &str,
    ) -> Result<(), AuthError> {
        let csrf = Self::csrf_token(api)
            .await
            .map_err(|e| AuthError(e.to_string()))?;
        let bytes = api
            .post_form(
                "api/auth/callback/credentials",
                &[
                    ("csrfToken", csrf.as_str()),
                    ("email", email),
                    ("accessToken", access_token),
                    ("json", "true"),
                ],
            )
            .await
            .map_err(|e| AuthError(e.to_string()))?;

        let redirect_url = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(ToString::to_string))
            .unwrap_or_default();

        let info = Self::session_info(api).await;
        if redirect_url.contains("error=") || info.email.is_none() {
            return Err(AuthError(
                "Không tạo được phiên đăng nhập. Vui lòng thử lại.".to_string(),
            ));
        }

        Ok(())
    }

    async fn csrf_token(api: &ApiClient) -> Result<String, ApiError> {
        #[derive(Deserialize)]
        struct Reply {
            #[serde(rename = "csrfToken")]
            csrf_token: String,
        }
        let r: Reply = api.get_json("api/auth/csrf", &[]).await?;
        Ok(r.csrf_token)
    }
}

fn translate_supabase_error(text: &str) -> &'static str {
    if text.contains("invalid login credentials") || text.contains("invalid_credentials") {
        "Tên tài khoản hoặc mật khẩu không chính xác."
    } else if text.contains("password should be at least") {
        "Mật khẩu phải có ít nhất 6 ký tự."
    } else if text.contains("rate limit") {
        "Quá nhiều lần thử. Vui lòng thử lại sau."
    } else if text.contains("invalid email") {
        "Định dạng email không hợp lệ."
    } else {
        "Đăng nhập thất bại. Vui lòng thử lại."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_email_normalizes_plain_usernames_and_emails() {
        assert_eq!(AuthService::auth_email("  PhongTCT "), "phongtct@musicweb.com");
        assert_eq!(
            AuthService::auth_email("User@Example.COM "),
            "user@example.com"
        );
    }
}

