//! Entry point: read config, set up logging, run the server.

use std::process::ExitCode;

use civpms_media::config::{Config, LogFormat};
use civpms_media::telemetry;

#[tokio::main]
async fn main() -> ExitCode {
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            telemetry::init(LogFormat::Json);
            tracing::error!(problems = ?error.problems, "{error}");
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    telemetry::init(config.log_format);
    match civpms_media::run(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = %error, "fatal");
            ExitCode::FAILURE
        }
    }
}
