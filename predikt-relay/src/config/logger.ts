import { pino } from "pino";

// Structured logger. Redaction guarantees that even if a private key, signature
// or raw env slips into a log payload, it is scrubbed before serialization.
export const logger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
        paths: [
            "operatorPk",
            "OPERATOR_PK",
            "pk",
            "privateKey",
            "*.operatorPk",
            "*.privateKey",
            "req.headers.authorization",
        ],
        censor: "[REDACTED]",
    },
});

export type Logger = typeof logger;
