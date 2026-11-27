use thiserror::Error;

#[derive(Debug, Error, Clone)]
pub enum ApiError {
    #[error("Vui lòng đăng nhập.")]
    Unauthorized,
    #[error("{}", .0.as_deref().unwrap_or("Máy chủ gặp lỗi, vui lòng thử lại."))]
    Server(Option<String>),
    #[error("Không kết nối được máy chủ: {0}")]
    Network(String),
    #[error("Dữ liệu máy chủ không hợp lệ: {0}")]
    Decode(String),
}

#[derive(Debug, Error, Clone)]
#[error("{0}")]
pub struct AuthError(pub String);

impl From<ApiError> for AuthError {
    fn from(value: ApiError) -> Self {
        Self(value.to_string())
    }
}

