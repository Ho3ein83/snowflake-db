const Snowflake = require("./Snowflake");

const fs = require("fs")
const path = require("path");

/**
 * @description Logger class for Snowflake
 * @since 1.0.0
 */
const SnowflakeLogger = (function(){

    /**
     * @class SnowflakeLogger
     */
    function SnowflakeLogger(conf={}){

        const _this = this;

        let mainPath = path.join(process.cwd(), "logs");

        if(!fs.existsSync(mainPath))
            fs.mkdirSync(mainPath);

        let _config = Object.assign({
            "enabled": false,
            "show_time": true,
            "time_format": "Y-m-d H:i:s",
            "use_colors": true
        }, conf);

        /**
         * ANSI escape key
         * @type {string}
         * @since 1.0.0
         */
        const escapeKey = "\x1b";

        /**
         * ANSI reset attribute
         * @type {string}
         * @since 1.0.0
         */
        this.closure = `${escapeKey}[0m`;

        /**
         * Request to clear the terminal
         * @type {string}
         * @since 1.0.0
         */
        this.clear = `\x1b[2J\x1b[H`;

        /**
         * ANSI color codes
         * @type {{magenta: string, green: string, underline: string, yellow: string, clear: string, cyan: string, red:
         *     string, orange: string, blue: string, white: string, warning: string, reset: string, faint: string}}
         * @since 1.0.0
         */
        this.colors = {
            "red": `${escapeKey}[31m`,
            "green": `${escapeKey}[32m`,
            "blue": `${escapeKey}[34m`,
            "cyan": `${escapeKey}[36m`,
            "yellow": `${escapeKey}[33m`,
            "orange": `${escapeKey}[38;5;214m`,
            "magenta": `${escapeKey}[35m`,
            "white": `${escapeKey}[39m`,
            "warning": `${escapeKey}[38;5;220m`,
            "reset": `${escapeKey}[0m`,
            "underline": `${escapeKey}[4m`,
            "no_underline": `${escapeKey}[24m`,
            "faint": `${escapeKey}[2m`,
            "clear": _this.closure,
        }

        /**
         * Special characters with colors
         * @type {{check: string, coloredCheck: string, x: string, coloredX: string}}
         * @since 1.0.0
         */
        this.characters = {
            check: "✓",
            coloredCheck: "%green%✓%green%%reset%",
            x: "🗴",
            coloredX: "%red%🗴%red%%reset%",
            info: "ℹ",
            infoColored: "%blue%ℹ%blue%%reset%",
            warning: "ℹ",
            warningColored: "%orange%ℹ%orange%%reset%",
        }

        /**
         * Get time with appropriate format
         * @param {string|null} format - Time format. Pss null to use default time format in configs file, or pass
         * 'Y' for year, 'm' for month, 'd' for day, 'H' for hour, 'i' for minute, 's' for second.
         * E.g: "Y/m/d H:i:s" would be "2024/12/20 13:29:05"
         * @return {string}
         * Formatted time
         * @since 1.0.0
         */
        this.getTime = (format=null) => {
            if(!format)
                format = _config.time_format;
            if(format){
                let d = new Date();
                format = format.toString();
                return format.replace(/Y/g, d.getFullYear().toString())
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
        this.getColor = (color, force=false) => {
            let c = _this.colors[color] || "";
            if(!_config.use_colors && !force)
                return _this.colors.reset;
            return c;
        }

        // Color regex for replacing percent-escaped codes with ANSI codes
        const colorRegex = /(%(red|green|orange|blue|cyan|yellow|magenta|white|warning|reset|clear|underline|no_underline|faint)%)/ig;

        /**
         * Format ANSI colors inside a string, colors are percent-escaped like: "%red%", "%green%", "%blue%"
         * @param {string} text - Original text containing escaped colors
         * @param {boolean} clean - Whether to replace the escaped colors with ANSI color code or just remove them
         * @return {string} - Formatted string with ANSI color codes
         * @sicne 1.0.0
         */
        this.formatColor = (text, clean = false) => {
            return text.toString().replace(colorRegex, function(match, content, input){
                if(clean)
                    return "";
                let color = _this.getColor(input);
                return color ? color : match;
            });
        }

        // Regex to match %char:someKey%
        const charRegex = /%char:([a-zA-Z0-9_]+)%/g;

        this.formatChars = (text, formatColors = false, clean = false) => {

            return text.toString().replace(charRegex, (_, key) => {
                if(clean)
                    return "";
                const icon = this.characters?.[key] ?? "";
                if(icon)
                    return formatColors ? this.formatColor(icon) : icon;
                return "";
            });

        }

        /**
         * Log a message into console, if 'logs.enabled' is false inside configs file, it won't log the message
         * @param {string} text - Input message to print in the log
         * @param {boolean} show_time - Whether to show current time before the message or not,
         * if you've been disabled 'logs.show_time' in the config file, it'll be ignored,
         * otherwise you can disable time for this message only by setting it to false
         * @return {SnowflakeLogger}
         * @since 1.0.0
         */
        this.log = (text, show_time=true) => {
            if(!_config.enabled)
                return this;
            let str = this.formatColor(text);
            let prefix = [];
            if(show_time && _config.show_time)
                prefix.push("[" + _this.getTime() + "]");
            str = Snowflake.inject(str, str.startsWith("\n") ? 1 : 0, prefix.join("") + " ");
            console.log(str.trim() + _this.colors.clear);
            return this;
        }

        /**
         * Log a message and add a new line after it
         * @param text
         * @return {SnowflakeLogger}
         * @since 1.0.0
         */
        this.logln = text => {
            this.log(text);
            console.log("");
            return this;
        }

        /**
         * Remove ANSI characters
         * @param {string} str
         * @return {*}
         * @since 1.0.0
         */
        this.stripAnsiCodes = str => str.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

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
        this.table = (table, indent = 3, color = "clear", spacer = " ", spaceOffset = 0, log = true) => {

            indent = Math.max(indent, 0);

            let space = 1, maxValueLength = 0;
            let text = "";

            for(let t of table){

                let {key, value} = t;

                // Remove percent-escaped color codes (e.g: %red% %green% %clear%)
                key = String(key).replaceAll(/%\w+%/g, "");
                value = String(value).replaceAll(/%\w+%/g, "");

                // Calculate the maximum length of the rows
                space = Math.max(space, key.length+1);
                maxValueLength = Math.max(maxValueLength, value.length+1);
            }

            for(let t of table){

                // Deconstruct table row properties
                const {key, value, divider} = t;
                let c = t.color || color;

                // Clean the key by removing percent-escaped color codes (e.g: %red% %green% %clear%)
                let cleanKey = key.replaceAll(/%\w+%/g, "");

                // Calculate the length without ANSI codes
                const keyLength = cleanKey.toString().length;

                // Space that needs to be added to the end of the row
                const padding = indent + keyLength + space - keyLength + 2;

                // Cleanup the value
                const parsedValue = this.formatColor(String(value).replaceAll("%padding%", " ".repeat(padding+spaceOffset)));

                // Append the string
                const _color = c;
                const _key = (divider ? "── " : "") + cleanKey;
                const _indent = " ".repeat(indent);
                const _spacer = (divider ? "─" : spacer).repeat(space-keyLength+spaceOffset + (divider ? (maxValueLength-3) : 0));
                const _value = divider ? "" : parsedValue.replaceAll("\n", "\n" + " ".repeat(space+spaceOffset+2));
                text += this.formatColor(`%${_color}%${_indent}${_key} ${_spacer} ${_value}%clear%\n`);

            }

            if(log)
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
        this.box = (title, content, borders=null) => {
            if(!borders || borders.length < 6)
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
         * @since 1.0.0
         */
        this.logFile = (content, name = null, append = false) => {
            try {
                const t = new Date().getTime().toString(),
                    time = parseInt(t.substring(0, t.length-3)).toString(),
                    file = (name || time) + ".log",
                    p = path.join(mainPath, file);
                if(append)
                    fs.appendFileSync(p, content);
                else
                    fs.writeFileSync(p, content);
                return file;
            } catch(e){
                this.log("Error, logFile(): " + e.toString());
            }
            return false;
        }

        /**
         * Log a message as error and exit the process
         * @param {string} text - Message text
         * @param {int} exit - Exit status code, default is 1
         * @param {string|false} mark - Mark the error message, pass false to ignore
         * @return {SnowflakeLogger}
         * @since 1.0.0
         */
        this.assert = (text, exit=1, mark=false) => {
            if(_config.enabled) {
                this.error(text, mark);
                this.logFile(this.formatColor(text, true), `Fatal ${new Date().toUTCString()}`);
            }
            if(exit !== false && exit >= 0)
                process.exit(exit);
            return this;
        }

        /**
         * Log a message as warning
         * @param {string} text - Message text
         * @param {string|false} mark - Mark the warning message, pass false to ignore
         * @return {SnowflakeLogger}
         * @since 1.0.0
         */
        this.warning = (text, mark=false) => {
            if(_config.enabled)
                this.log(`%orange%[WARNING]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);
            return this;
        }

        /**
         * Log a message as success
         * @param {string} text - Message text
         * @param {string|false} mark - Mark the success message, pass false to ignore
         * @return {SnowflakeLogger}
         * @since 1.0.0
         */
        this.success = (text, mark=false) => {
            if(_config.enabled)
                this.log(`%green%[SUCCESS]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);
            return this;
        }

        /**
         * Log a message as information
         * @param {string} text - Message text
         * @param {string|false} mark - Mark the info message, pass false to ignore
         * @return {SnowflakeLogger}
         * @since 1.0.0
         */
        this.info = (text, mark=false) => {
            if(_config.enabled)
                this.log(`%blue%[INFO]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);
            return this;
        }

        /**
         * Log a message as runtime error
         * @param {string} text - Message text
         * @param {string|false} mark - Mark the error message, pass false to ignore
         * @return {SnowflakeLogger}
         * @since 1.0.0
         */
        this.error = (text, mark=false) => {
            if(_config.enabled)
                this.log(`%red%[ERROR]${mark ? `[${mark.toString().toUpperCase()}]` : ""} ${text}`);
            return this;
        }

    }

    return SnowflakeLogger;

}());

module.exports = SnowflakeLogger;