//! Cached reads. Data is RLS-scoped, so keys are per user (except the public holiday list).
//! Responses carry `x-cache: HIT|MISS|STALE|BYPASS` and `Age`; send
//! `Cache-Control: no-cache` to bypass the cache (e.g. right after a mutation).

use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use http::header::{AGE, CACHE_CONTROL, PRAGMA};
use http::{HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::cache::{CachePolicy, CacheResult, FetchError};
use crate::error::AppError;
use crate::ratelimit::RateClass;
use crate::state::AppState;

/// Holidays change by proclamation a few times a year: serve stale copies for up to a week.
const HOLIDAYS_STALE_MAX: Duration = Duration::from_hours(7 * 24);

pub(crate) fn wants_bypass(headers: &HeaderMap) -> bool {
    let has_no_cache = |value: Option<&HeaderValue>| {
        value.and_then(|v| v.to_str().ok()).is_some_and(|v| {
            v.split(',').any(|d| {
                matches!(
                    d.trim().to_ascii_lowercase().as_str(),
                    "no-cache" | "no-store" | "max-age=0"
                )
            })
        })
    };
    has_no_cache(headers.get(CACHE_CONTROL)) || has_no_cache(headers.get(PRAGMA))
}

pub(crate) fn cached_response(result: &CacheResult) -> Response {
    let mut response = Json(&*result.value).into_response();
    let headers = response.headers_mut();
    headers.insert("x-cache", HeaderValue::from_static(result.status.as_str()));
    headers.insert(AGE, HeaderValue::from(result.age.as_secs()));
    response
}

fn policy(ttl: Duration, stale_max: Duration) -> CachePolicy {
    CachePolicy {
        ttl,
        swr: ttl.min(Duration::from_hours(1)),
        stale_max,
    }
}

/// `GET /v1/projects`: the caller's projects (rows of `project_overview`).
pub async fn list_projects(
    State(state): State<AppState>,
    user: AuthUser,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    state.limiter.check(RateClass::Read, user.id).await?;
    let key = format!("c:v1:projects:{}", user.id);
    let policy = policy(
        state.config.cache.projects_ttl,
        state.config.cache.stale_max,
    );
    let fetch_state = state.clone();
    let token: Arc<str> = Arc::from(user.token());
    let result = state
        .cache
        .get_or_fetch(key, policy, wants_bypass(&headers), move || async move {
            fetch_state
                .supabase
                .rest_get(
                    &token,
                    "/rest/v1/project_overview?select=*&order=updated_at.desc",
                )
                .await
        })
        .await?;
    Ok(cached_response(&result))
}

/// `GET /v1/projects/{id}/summary`: one row of `project_overview`.
pub async fn project_summary(
    State(state): State<AppState>,
    user: AuthUser,
    Path(raw_id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let project_id = Uuid::parse_str(&raw_id)
        .map_err(|_| AppError::validation("The project id must be a UUID."))?;
    state.limiter.check(RateClass::Read, user.id).await?;
    let key = format!("c:v1:summary:{}:{project_id}", user.id);
    let policy = policy(
        state.config.cache.projects_ttl,
        state.config.cache.stale_max,
    );
    let fetch_state = state.clone();
    let token: Arc<str> = Arc::from(user.token());
    let result = state
        .cache
        .get_or_fetch(key, policy, wants_bypass(&headers), move || async move {
            let rows = fetch_state
                .supabase
                .rest_get(
                    &token,
                    &format!("/rest/v1/project_overview?select=*&id=eq.{project_id}&limit=1"),
                )
                .await?;
            first_row(rows)
        })
        .await?;
    Ok(cached_response(&result))
}

fn first_row(rows: Value) -> Result<Value, FetchError> {
    match rows {
        Value::Array(mut items) if !items.is_empty() => Ok(items.swap_remove(0)),
        Value::Array(_) => Err(FetchError::Rejected(AppError::not_found(
            "This project does not exist or you no longer have access to it.",
        ))),
        _ => Err(FetchError::Unavailable(
            "unexpected PostgREST payload".into(),
        )),
    }
}

#[derive(Debug, Deserialize)]
pub struct HolidayQuery {
    year: Option<String>,
}

/// `GET /v1/holidays?year=YYYY`: Philippine holidays (same for every signed-in user).
pub async fn holidays(
    State(state): State<AppState>,
    user: AuthUser,
    Query(query): Query<HolidayQuery>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let year: u16 = query
        .year
        .as_deref()
        .and_then(|y| y.parse().ok())
        .filter(|y| (2000..=2100).contains(y))
        .ok_or_else(|| {
            AppError::validation("Pass ?year=YYYY with a year between 2000 and 2100.")
        })?;
    state.limiter.check(RateClass::Read, user.id).await?;
    let key = format!("c:v1:holidays:{year}");
    let stale_max = state.config.cache.stale_max.max(HOLIDAYS_STALE_MAX);
    let policy = policy(state.config.cache.holidays_ttl, stale_max);
    let fetch_state = state.clone();
    let token: Arc<str> = Arc::from(user.token());
    let result = state
        .cache
        .get_or_fetch(key, policy, wants_bypass(&headers), move || async move {
            fetch_state
                .supabase
                .rest_get(
                    &token,
                    &format!(
                        "/rest/v1/ph_holidays?select=date,name,type&year=eq.{year}&order=date.asc"
                    ),
                )
                .await
        })
        .await?;
    Ok(cached_response(&result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bypass_detection() {
        let mut headers = HeaderMap::new();
        assert!(!wants_bypass(&headers));
        headers.insert(
            CACHE_CONTROL,
            HeaderValue::from_static("max-age=0, private"),
        );
        assert!(wants_bypass(&headers));
        let mut headers = HeaderMap::new();
        headers.insert(PRAGMA, HeaderValue::from_static("no-cache"));
        assert!(wants_bypass(&headers));
    }

    #[test]
    fn first_row_handles_empty_results() {
        assert_eq!(
            first_row(serde_json::json!([{"id": 1}])).unwrap(),
            serde_json::json!({"id": 1})
        );
        assert!(matches!(
            first_row(serde_json::json!([])),
            Err(FetchError::Rejected(_))
        ));
    }
}
