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

        let main_path = path.join(process.cwd(), "logs");

        if(!fs.existsSync(main_path))
            fs.mkdirSync(main_path);

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
        const escape_key = "\x1b";

        /**
         * ANSI reset attribute
         * @type {string}
         * @since 1.0.0
         */
        this.closure = `${escape_key}[0m`;

        /**
         * Request to clear the terminal
         * @type {string}
         * @since 1.0.0
         */
        this.clear = `\x1b[2J\x1b[H`;

        /**
         * ANSI color codes
         * @type {{magenta: string, green: string, underline: string, yellow: string, clear: string, cyan: string, red: string, orange: string, blue: string, white: string, warning: string, reset: string, faint: string}}
         * @since 1.0.0
         */
        this.colors = {
            "red": `${escape_key}[31m`,
            "green": `${escape_key}[32m`,
            "blue": `${escape_key}[34m`,
            "cyan": `${escape_key}[36m`,
            "yellow": `${escape_key}[33m`,
            "orange": `${escape_key}[38;5;214m`,
            "magenta": `${escape_key}[35m`,
            "white": `${escape_key}[39m`,
            "warning": `${escape_key}[38;5;220m`,
            "reset": `${escape_key}[0m`,
            "underline": `${escape_key}[4m`,
            "faint": `${escape_key}[2m`,
            "clear": _this.closure,
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
        this.get_time = (format=null) => {
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
        this.get_color = (color, force=false) => {
            let c = _this.colors[color] || "";
            if(!_config.use_colors && !force)
                return _this.colors.reset;
            return c;
        }

        this.format_color = (text, clean = false) => {
            return text.toString().replace(/(%(red|green|orange|blue|cyan|yellow|magenta|white|warning|reset|clear|underline|faint)%)/ig, function(match, content, input, offset){
                if(clean)
                    return "";
                let color = _this.get_color(input);
                return color ? color : match;
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
            let str = this.format_color(text);
            let prefix = [];
            if(show_time && _config.show_time)
                prefix.push("[" + _this.get_time() + "]");
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
         * Print a table
         * @param {object[]} table - Table items list
         * @param {number} indent - The number of indents at the beginning of each entry
         * @param {string} color - The default color of the table
         * @param {string} spacer - The default spacer for spacing key and value
         * @param {number} space_offset - Offset to be added to the spacer number
         * @param {boolean} log - Whether to log the text, default is true
         * @return {string} - Table text
         * @since 1.0.0
         */
        this.table = (table, indent = 3, color = "clear", spacer = " ", space_offset = 0, log = true) => {
            indent = Math.max(indent, 0);
            let space = 1;
            let text = "";
            for(let t of table){
                let {key} = t;
                key = key.replaceAll(/%\w+%/g, "");
                space = Math.max(space, key.length+1);
            }
            for(let t of table){
                let {key, value, color: c} = t;
                let clean_key = key.replaceAll(/%\w+%/g, "");
                c = c || color;
                const padding = indent + clean_key.length + space - clean_key.length + 2;
                text += `%${c}%${" ".repeat(indent)}${key} ${spacer.repeat(space-clean_key.length+space_offset)} ${String(value).replaceAll("%padding%", " ".repeat(padding+space_offset))}\n`;
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
            const maxLineLength = Math.max(title.length, ...lines.map(line => line.length));
            const boxWidth = maxLineLength + 1; // Add padding

            const topBorder = `${borders[0]} ${title} ${borders[1].repeat(boxWidth - title.length - 1)}` + borders[2];
            const bottomBorder = `${borders[4]}${borders[1].repeat(boxWidth + 1)}${borders[3]}`;

            const paddedLines = lines.map(line => {
                const padding = ' '.repeat(boxWidth - line.length);
                return `${borders[5]} ${line}${padding}${borders[5]}`;
            });

            return [topBorder, ...paddedLines, bottomBorder].join('\n');
        };

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
                    p = path.join(main_path, file);
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
            if(_config.enabled)
                this.error(text, mark);
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