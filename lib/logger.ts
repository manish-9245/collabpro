type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

class Logger {
  private getLogLevelPriority(level: LogLevel): number {
    switch (level) {
      case "DEBUG": return 0;
      case "INFO": return 1;
      case "WARN": return 2;
      case "ERROR": return 3;
    }
  }

  private currentLevel(): LogLevel {
    const envLevel = (process.env.LOG_LEVEL || "INFO").toUpperCase();
    if (["DEBUG", "INFO", "WARN", "ERROR"].includes(envLevel)) {
      return envLevel as LogLevel;
    }
    return "INFO";
  }

  private shouldLog(level: LogLevel): boolean {
    return this.getLogLevelPriority(level) >= this.getLogLevelPriority(this.currentLevel());
  }

  private formatLog(level: LogLevel, message: string, context?: any, error?: any): string {
    const isProd = process.env.NODE_ENV === "production";
    const timestamp = new Date().toISOString();
    
    if (isProd) {
      const logObject: any = {
        timestamp,
        level,
        message,
      };
      if (context) {
        logObject.context = context;
      }
      if (error) {
        logObject.error = {
          name: error.name,
          message: error.message,
          stack: error.stack,
          ...(typeof error === 'object' ? error : {}),
        };
      }
      return JSON.stringify(logObject);
    } else {
      let msg = `[${timestamp}] [${level}] ${message}`;
      if (context) {
        msg += ` | Context: ${JSON.stringify(context)}`;
      }
      if (error) {
        msg += ` | Error: ${error.message || error}`;
        if (error.stack) {
          msg += `\n${error.stack}`;
        }
      }
      return msg;
    }
  }

  public debug(message: string, context?: any) {
    if (this.shouldLog("DEBUG")) {
      console.log(this.formatLog("DEBUG", message, context));
    }
  }

  public info(message: string, context?: any) {
    if (this.shouldLog("INFO")) {
      console.log(this.formatLog("INFO", message, context));
    }
  }

  public warn(message: string, context?: any) {
    if (this.shouldLog("WARN")) {
      console.warn(this.formatLog("WARN", message, context));
    }
  }

  public error(message: string, error?: any, context?: any) {
    if (this.shouldLog("ERROR")) {
      console.error(this.formatLog("ERROR", message, context, error));
    }
  }
}

export const logger = new Logger();
