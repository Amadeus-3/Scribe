import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/**
 * Structured JSON logging with secret redaction (Spec §10.1.3, §11).
 *
 * Secrets must never appear in logs. The redaction path list below masks the
 * obvious credential-bearing fields; the security test suite asserts secrets
 * never leak. Extend this list whenever a new secret-bearing field is added.
 */
export const REDACT_PATHS: string[] = [
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
  'cookie',
  '*.cookie',
  'headers.cookie',
  'apiKey',
  '*.apiKey',
  'secret',
  '*.secret',
  // Named environment secrets
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AUTH_SECRET',
  'ENCRYPTION_KEY',
  'INNGEST_SIGNING_KEY',
  'INNGEST_EVENT_KEY',
  'EMAIL_SERVER',
  'GSC_SERVICE_ACCOUNT_JSON',
  // Domain secrets
  'cmsCredentials',
  '*.cmsCredentials',
  'credentialsEnc',
  '*.credentialsEnc',
  'cmsCredentialsEnc',
  '*.cmsCredentialsEnc',
  // Service-account key material
  'private_key',
  '*.private_key',
  'client_email',
  '*.client_email',
];

export interface CreateLoggerOptions {
  service?: string;
  level?: string;
  /** When provided, logs are written here and the dev pretty-transport is skipped. */
  destination?: DestinationStream;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const isDev = process.env.NODE_ENV === 'development';
  const level =
    opts.level ??
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

  const options: LoggerOptions = {
    level,
    base: opts.service ? { service: opts.service } : undefined,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Pretty output only in interactive dev, and never when piping to a custom
    // destination (transports and explicit destinations are mutually exclusive).
    ...(isDev && !opts.destination
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };

  return opts.destination ? pino(options, opts.destination) : pino(options);
}

/** Default application logger. */
export const logger = createLogger({ service: 'scribe' });
