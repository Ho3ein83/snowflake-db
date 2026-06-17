const Snowflake = require("./Snowflake");

const fs = require("fs")
const path = require("path");
const snowflakeEvents = require("./SnowflakeEvents");

/**
 * @class SnowflakeLogger
 * @description Logger class for Snowflake
 * @since 1.0.0
 */

class SnowflakeLogger {

    /**
     * ANSI escape key
     * @type {string}
     * @since 1.0.0
     */
    escapeKey = "\x1b";

    /**
     * ANSI reset attribute
     * @type {string}
     * @since 1.0.0
     */
    closure = `${this.escapeKey}[0m`;

    /**
     * Request to clear the terminal
     * @type {string}
     * @since 1.0.0
     */
    clear = `\x1b[2J\x1b[H`;

    /**
     * ANSI color codes
     * @type {{magenta: string, green: string, underline: string, yellow: string, clear: string, cyan: string, red:
     *     string, orange: string, blue: string, white: string, warning: string, reset: string, faint: string}}
     * @since 1.0.0
     */
    colors = {
        "red": `${this.escapeKey}[31m`,
        "green": `${this.escapeKey}[32m`,
        "blue": `${this.escapeKey}[34m`,
        "cyan": `${this.escapeKey}[36m`,
        "yellow": `${this.escapeKey}[33m`,
        "orange": `${this.escapeKey}[38;5;214m`,
        "magenta": `${this.escapeKey}[35m`,
        "white": `${this.escapeKey}[39m`,
        "warning": `${this.escapeKey}[38;5;220m`,
        "reset": `${this.escapeKey}[0m`,
        "underline": `${this.escapeKey}[4m`,
        "no_underline": `${this.escapeKey}[24m`,
        "faint": `${this.escapeKey}[2m`,
        "clear": this.closure,
    };

    /**
     * Special characters with colors
     * @type {{check: string, coloredCheck: string, x: string, coloredX: string}}
     * @since 1.0.0
     */
    characters = {
        check: "✓",
        coloredCheck: "%green%✓%green%%reset%",
        x: "🗴",
        coloredX: "%red%🗴%red%%reset%",
        info: "ℹ",
        infoColored: "%blue%ℹ%blue%%reset%",
        warning: "ℹ",
        warningColored: "%orange%ℹ%orange%%reset%",
    };

    /**
     * Object to store benchmark timing
     * @type {{[id: number|string]: number}}
     * @since 1.0.0
     */
    #timing = {}

    /**
     * Timing counter for measuring benchmarks, incrementing after each measurement.
     * @type {number}
     * @since 1.0.0
     */
    #timingCounter = 0;

    /**
     * Configuration object
     * @type {SFConfigurationLogs|{}}
     * @since 1.0.0
     */
    #config = {};

    /**
     * @param {SFConfigurationLogs|{}} conf - Configuration object obtained from YAML config
     * @param {string} logsDir - Logs directory path
     */
    constructor(conf = {}, logsDir = null) {

        this.mainPath = Snowflake.resolvePath(logsDir === null ? "logs" : logsDir);

        if (!fs.existsSync(this.mainPath))
            fs.mkdirSync(this.mainPath);

        this.#config = Object.assign({
            enabled: false,
            show_time: true,
            time_format: "Y-m-d H:i:s",
            use_colors: true,
            save_cli_connections: true,
            save_cli_logins: true,
            benchmark: true,
            backup_logs: true,
            snapshot_logs: true
        }, conf);

    }

    /**
     * Get time with appropriate format
     * @param {string|null} format - Time format. Pass null to use default time format in configs file, or pass
     * 'Y' for year, 'm' for month, 'd' for day, 'H' for hour, 'i' for minute, 's' for second.
     * E.g: "Y/m/d H:i:s" would be "2024/12/20 13:29:05"
     * @return {string}
     * Formatted time
     * @since 1.0.0
     */
    getTime(format = null) {

        // Use time format from configs.yaml as fallback
        if (format === null)
            format = this.#config.time_format;

        if (format) {

            let d = new Date();

            // Replace each name with date
            return format.toString().replace(/Y/g, d.getFullYear().toString())
                .replace(/m/g, Snowflake.zeroFill((d.getMonth() + 1).toString()))
                .replace(/d/g, Snowflake.zeroFill(d.getDate().toString()))
                .replace(/H/g, Snowflake.zeroFill(d.getHours().toString()))
                .replace(/i/g, Snowflake.zeroFill(d.getMinutes().toString()))
                .replace(/s/g, Snowflake.zeroFill(d.getSeconds().toString()));

        }

        return "";

    }

    /**
     * Get ANSI color code (e.g: "\e[31m", "\e[34m") by its name (e.g: "red", "blue")
     * @param {string} color - Color name
     * @param {boolean} force - If 'logs.use_colors' option is disabled in the configs file,
     * it'll return "\e[0m" ANSI code (reset code), but if you force it you can still get the actual color code
     * @return {string}
     * ANSI color code
     * @since 1.0.0
     */
    getColor(color, force = false) {

        // If not forced to return the color and the coloring was disabled in configs.yaml
        if (!this.#config.use_colors && !force)
            return this.colors.reset;

        // Return the color (if found)
        return this.colors[color] || "";

    }

    /**
     * Format ANSI colors inside a string, colors are percent-escaped like: "%red%", "%green%", "%blue%"
     * @param {string} text - Original text containing escaped colors
     * @param {boolean} clean - Whether to replace the escaped colors with ANSI color code or just remove them
     * @return {string} - Formatted string with ANSI color codes
     * @sicne 1.0.0
     */
    formatColor(text, clean = false) {

        return text.toString()
            .replace(
                /(%(red|green|orange|blue|cyan|yellow|magenta|white|warning|reset|clear|underline|no_underline|faint)%)/ig,
                (match, content, input) => {

                    // Remove colors
                    if (clean)
                        return "";

                    // Find the color
                    let color = this.getColor(input);

                    // Return the color (if found)
                    return color ? color : match;

                }
            );

    }

    /**
     * Format special characters
     * @param {string} text - Message text
     * @param {boolean} formatColors - Whether to format the colors too, or just special characters
     * @param {boolean} clean - Whether to clean the message instead of formatting it
     * @returns {string}
     */
    formatChars(text, formatColors = false, clean = false) {

        return text.toString().replace(/%char:([a-zA-Z0-9_]+)%/g, (_, key) => {

            // Remove special characters
            if (clean)
                return "";

            // Find the appropriate character
            const icon = this.characters?.[key] ?? "";

            // Format the color if needed
            if (icon)
                return formatColors ? this.formatColor(icon) : icon;

            // Special character didn't exist
            return "";

        });

    }

    /**
     * Log a message into console; Won't work if `logs.enabled` is `false` in the configuration file.
     * @param {string} text - Input message to print in the log
     * @param {boolean|null} showTime - Whether to display current time before the message, if set it to `null`,
     * it'll use `logs.show_time` value from configuration file, otherwise you can force it by setting it to `true`
     * or `false`.
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @return {SnowflakeLogger}
     * @since 1.0.0
     */
    log(text, showTime = null, logId = null) {

        // If logs are disabled from configs.yaml file
        if (!this.#config.enabled)
            return this;

        // console.log(logId, this.messageAllowed(logId));

        // Filter messages if needed
        if (!this.messageAllowed(logId))
            return this;

        // Whether to display time (use fallback value if it was null)
        if (showTime === null)
            showTime = this.#config.show_time;

        // Replace color macros with ANSI colors (if enabled)
        let str = this.formatColor(text);

        // Add time and other prefixes
        let prefix = [];
        if (showTime)
            prefix.push("[" + this.getTime() + "]");

        // Prepend the prefix (if the line starts with break-line, it'll insert the prefix after that)
        str = Snowflake.inject(str, str.startsWith("\n") ? 1 : 0, prefix.join("") + " ");

        console.log(str.trim().replaceAll("\x00", " ") + this.colors.clear);

        // Return the current instance for method chaining
        return this;

    }

    /**
     * Log the message with a line break at the end
     * @param {string} text - Log message
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @return {SnowflakeLogger}
     * @since 1.0.0
     */
    logln(text, logId = null) {

        // Filter messages if needed
        if (!this.messageAllowed(logId))
            return this;

        this.log(text, null, logId);
        console.log("");

        return this;

    }

    /**
     * Remove ANSI characters
     * @param {string} str
     * @return {*}
     * @since 1.0.0
     */
    stripAnsiCodes(str) {
        return str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    }

    /**
     * Print a table
     * @param {{key: string, value: any, color: string}[]} table - Table items list
     * @param {number} indent - The number of indents at the beginning of each entry
     * @param {string} color - The default color of the table
     * @param {string} spacer - The default spacer for spacing key and value
     * @param {number} spaceOffset - Offset to be added to the spacer number
     * @param {boolean} log - Whether to log the text, default is true
     * @return {string} - Table text
     * @since 1.0.0
     */
    table(table, indent = 3, color = "clear", spacer = " ", spaceOffset = 0, log = true) {

        indent = Math.max(indent, 0);

        let space = 1, maxValueLength = 0;
        let text = "";

        for (let t of table) {

            let { key, value } = t;

            // Remove percent-escaped color codes (e.g: %red% %green% %clear%)
            key = String(key).replaceAll(/%\w+%/g, "");
            value = String(value).replaceAll(/%\w+%/g, "");

            // Calculate the maximum length of the rows
            space = Math.max(space, key.length + 1);
            maxValueLength = Math.max(maxValueLength, value.length + 1);
        }

        for (let t of table) {

            // Deconstruct table row properties
            const { key, value, divider } = t;
            let c = t.color || color;

            // Clean the key by removing percent-escaped color codes (e.g: %red% %green% %clear%)
            let cleanKey = key.replaceAll(/%\w+%/g, "");

            // Calculate the length without ANSI codes
            const keyLength = cleanKey.toString().length;

            // Space that needs to be added to the end of the row
            const padding = indent + keyLength + space - keyLength + 2;

            // Cleanup the value
            const parsedValue = this.formatColor(String(value).replaceAll("%padding%", " ".repeat(padding + spaceOffset)));

            // Append the string
            const _color = c;
            const _key = (divider ? "── " : "") + cleanKey;
            const _indent = " ".repeat(indent);
            const _spacer = (divider ? "─" : spacer).repeat(space - keyLength + spaceOffset + (divider
                                                                                               ? (maxValueLength - 3)
                                                                                               : 0));
            const _value = divider ? "" : parsedValue.replaceAll("\n", "\n" + " ".repeat(space + spaceOffset + 2));
            text += this.formatColor(`%${_color}%${_indent}${_key} ${_spacer} ${_value}%clear%\n`);

        }

        if (log)
            this.log(text);

        return text;
    }

    /**
     * Create a box
     * @param {string} title - Box title
     * @param {string} content - Box content
     * @param {string|null} borders - Borders characters, pass null to use "╭─╮╯╰│", Default is null.
     * @return {string}
     * @since 1.0.0
     */
    box(title, content, borders = null) {
        if (!borders || borders.length < 6)
            borders = "╭─╮╯╰│";

        const lines = content.split("\n");
        const maxLineLength = Math.max(title.length, ...lines.map(line => this.stripAnsiCodes(line.toString()).length));
        const boxWidth = maxLineLength + 1; // Add padding

        const topBorder = `${borders[0]} ${title} ${borders[1].repeat(boxWidth - title.length - 1)}` + borders[2];
        const bottomBorder = `${borders[4]}${borders[1].repeat(boxWidth + 1)}${borders[3]}`;

        const paddedLines = lines.map(line => {
            const cleanLine = this.stripAnsiCodes(line.toString());
            const padding = ' '.repeat(boxWidth - cleanLine.length);
            return `${borders[5]} ${line}${padding}${borders[5]}`;
        });

        return [topBorder, ...paddedLines, bottomBorder].join('\n');
    }

    /**
     * Log a message into a file inside logs directory located in configs.yaml,
     * please remember this will overwrite existing log file (and won't append it).
     * @param {string} content - Log content
     * @param {string|null} name - Target log file name, pass null to autogenerate
     * @param {boolean} append - Whether to append to the file or overwrite it
     * @return {string|boolean} - The log file name on success, false on failure
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @since 1.0.0
     */
    logFile(content, name = null, append = false, logId = null) {

        // No need to filter `logId`, all file logs are high priority, but it's better to still pass `logId`

        try {

            const t = new Date().getTime().toString(),
                time = parseInt(t.substring(0, t.length - 3)).toString(),
                file = (name || time) + ".log",
                p = path.join(this.mainPath, file);

            if (append)
                fs.appendFileSync(p, content);
            else
                fs.writeFileSync(p, content);

            return file;

        } catch (e) {

            this.log("Error, logFile(): " + e.toString());

        }

        return false;

    }

    /**
     * Log a message as error and exit the process
     * @param {string} text - Message text
     * @param {int|false} exit - Exit status code or `false` to not exit, default is 1
     * @param {string|false} mark - Mark the error message, pass false to ignore
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @return {SnowflakeLogger}
     * @since 1.0.0
     */
    assert(text, exit = 1, mark = false, logId = null) {

        // No need to filter `logId`, all assertions are high priority, but it's better to still pass `logId`

        if (this.#config.enabled) {
            this.error(text, mark);
            this.logFile(this.formatColor(text, true), `Fatal ${new Date().toUTCString()}`);
        }

        if (exit !== false && exit >= 0)
            process.exit(exit);

        return this;

    }

    /**
     * Log a message as warning
     * @param {string} text - Message text
     * @param {string|false} mark - Mark the warning message, pass false to ignore
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @return {SnowflakeLogger}
     * @since 1.0.0
     */
    warning(text, mark = false, logId = null) {

        // No need to filter `logId`, all warnings are high priority, but it's better to still pass `logId`

        if (this.#config.enabled)
            this.log(`%orange%[WARNING]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);

        return this;

    }

    /**
     * Log a message as success
     * @param {string} text - Message text
     * @param {string|false} mark - Mark the success message, pass false to ignore
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @return {SnowflakeLogger}
     * @since 1.0.0
     */
    success(text, mark = false, logId = null) {

        // Filter messages if needed
        if (!this.messageAllowed(logId))
            return this;

        if (this.#config.enabled)
            this.log(`%green%[SUCCESS]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);

        return this;

    }

    /**
     * Log a message as information
     * @param {string} text - Message text
     * @param {string|false} mark - Mark the info message, pass false to ignore
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @return {SnowflakeLogger}
     * @since 1.0.0
     */
    info(text, mark = false, logId = null) {

        // Filter messages if needed
        if (!this.messageAllowed(logId))
            return this;

        if (this.#config.enabled)
            this.log(`%blue%[INFO]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);

        return this;

    }

    /**
     * Log a message as runtime error
     * @param {string} text - Message text
     * @param {string|false} mark - Mark the error message, pass false to ignore
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @return {SnowflakeLogger}
     * @since 1.0.0
     */
    error(text, mark = false, logId = null) {

        // No need to filter `logId`, all errors are high priority, but it's better to still pass `logId`

        if (this.#config.enabled)
            this.log(`%red%[ERROR]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);

        return this;

    }

    /**
     * Start time measurement for benchmarks
     * @param {string|number|null} id - Benchmark ID
     * @returns {number|null} - Started time in millisecond
     * @since 1.0.0
     */
    timeStart(id = null) {

        // When giving an invalid ID, it uses the internal counter
        if (id === null || !["number", "string"].includes(typeof id)) {
            this.#timing[++this.#timingCounter] = performance.now();
            return this.#timingCounter;
        }
        else {
            this.#timing[id] = performance.now();
            return id;
        }

    }

    /**
     * Finish the time measurement
     * @param {string|number|null} id - Benchmark ID
     * @returns {number|null} - The execution time in milliseconds
     * @since 1.0.0
     */
    timeEnd(id = null) {

        // If an invalid ID was given, get the first record from the timing table
        if (id === null || !["number", "string"].includes(typeof id))
            id = Object.keys(this.#timing)[0];

        // If an ID was given, try to read it from the timing table and subtract current time from it
        if (id) {
            const start = this.#timing[id];
            return performance.now() - start;
        }

        return null;

    }

    /**
     * Print benchmark message
     * @param {string} message - Benchmark message, the execution time will be added after the message
     * @param {string|number|null} id - Benchmark ID
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @since 1.0.0
     */
    benchmark(message, id = null, logId = null) {

        // If benchmark is disabled in configuration file, just call the callback without any measurements
        if (!this.#config.benchmark)
            return;

        // Filter messages if needed
        if (!this.messageAllowed(logId))
            return;

        // Finish the measurement
        const end = this.timeEnd(id);

        // If the benchmark was started, print the execution time
        if (end !== null) {
            const time = end >= 1000 ? end / 1000 : end;
            const doneIn = Number(time).toFixed(4).toString().replace(".0000", "");
            this.log(`%faint%${message} in ${doneIn}${end >= 1000 ? "s" : "ms"}`);
        }

    }

    /**
     * Call a function and measure the execution time and print it next to the message
     * @param {function} callback - Function you want to measure its execution time
     * @param {string} message - Message text
     * @param {string|number|null} id - Benchmark ID
     * @param {string|null} logId - Log message ID, it can be used to filter some log messages
     * @since 1.0.0
     */
    benchmarkCode(callback, message, id = null, logId = null) {

        // No benchmark
        if (!this.#config.benchmark) {
            callback();
            return;
        }

        // Filter messages if needed
        if (!this.messageAllowed(logId))
            return;

        // Start measuring execution time
        const newId = this.timeStart(id);

        callback();

        // Print how much time did it take to execute
        this.benchmark(message, newId);

    }

    /**
     * Check if a specific group of messages is allowed and not filtered
     * @param {string} logId
     * @returns {boolean}
     * @since 1.0.0
     */
    messageAllowed(logId) {

        // If `logId` is started with underscore (_), it means the message must be printed with high priority

        if (logId === "backup")
            return this.#config.backup_logs;
        else if (logId === "snapshot")
            return this.#config.snapshot_logs;
        else if (logId === "database")
            return this.#config.database_logs;
        else if (logId === "server")
            return this.#config.server_logs;
        else if (logId === "system")
            return this.#config.system_logs;
        else if (logId === "cypher")
            return this.#config.cypher_logs;
        else if (logId === "cli")
            return this.#config.cli_logs;
        else if (logId === "shell")
            return this.#config.shell_logs;

        // Still can filter other logs (even the high priority ones)
        return snowflakeEvents.filter("log_message_allowed", true, logId);

    }

}

module.exports = SnowflakeLogger;