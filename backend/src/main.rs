//! Entry point: read config, set up logging, run the server.

use std::process::ExitCode;

use civpms_media::config::{Config, LogFormat};
use civpms_media::telemetry;

#[tokio::main]
async fn main() -> ExitCode {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        #[allow(clippy::print_stdout)] // the one intended stdout write
        {
            println!("civpms-media {}", env!("CARGO_PKG_VERSION"));
        }
        return ExitCode::SUCCESS;
    }
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
