const Snowflake = require("./Snowflake");
const SnowflakeEvents = require("./SnowflakeEvents");
const SnowflakeShell = require("./SnowflakeShell");
const { v4: uuid4 } = require("uuid");
const { createServer } = require("net");
const fs = require("fs");

const appConfig = require("../../app.json");

/**
 * @class SnowflakeCLI
 * @description The CLI core class for command line access
 * @since 1.0.0
 */
class SnowflakeCLI {

    /**
     * TCP server connection
     * @type {import("net").Server|null}
     * @since 1.0.0
     */
    #tcp = null;

    /**
     * Available connections
     * @type {Map<string, import("./SnowflakeShell")>}
     * @since 1.0.0
     */
    #connections = new Map();

    /**
     * Tokens list
     * @type {Map<string, number>}
     * @since 1.0.0
     */
    #sessions = new Map();

    /**
     * The list of existing commands
     * @type {Object}
     * @since 1.0.0
     */
    #commands = {};

    /**
     * The list of aliases for existing commands
     * @type {Object}
     * @since 1.0.0
     */
    #aliases = {};

    /**
     * Lockdown data
     * @type {Object}
     * @since 1.0.0
     */
    #lockdown = {};

    /**
     * Lockdown file path
     * @type {string}
     * @since 1.0.0
     */
    #lockdown_file = "";

    /**
     * Configurations
     * @type {{log_connections: boolean, authentication_timeout: number, lockdown: string, cooldown: number, log_logins: boolean, max_login_attempt: number}}
     * @since 1.0.0
     */
    #configs = {
        log_logins: false,
        log_connections: false,
        lockdown: "none",
        cooldown: 60,
        authentication_timeout: 30000,
        max_login_attempt: 0,
    };

    constructor() {
        this.#initCommands();
        this.#lockdown_file = Snowflake.resolvePath(".lockdown");
    }

    /**
     * Initialize commands
     * @return {SnowflakeCLI} - Returns the current instance of SnowflakeCLI for method chaining.
     * @since 1.0.0
     */
    #initCommands() {
        this.command("help", {
            exec: d => {
                const { args } = d;
                return [this.getHelp(args.length > 0 ? args : null), "", 0];
            },
            help: `Get the list of existing commands with usage
Usage: help [?COMMANDS]
    [COMMANDS]:
        * Optional
        * Space separated commands you want to know more about.
Examples: help
          help command1
          help command1 command2
          help clear get set`,
            internal: true
        });
        this.command("clear", {
            help: `Clears your screen if this is possible.
Alias: cls`,
            internal: true,
            alias: "cls"
        });
        this.command("exit", {
            help: `Exit the shell
Usage: exit [?STATUS]
    [STATUS]:
    * Optional
    * Exits the shell with a status. If [STATUS] is omitted or invalid,
      the exit status will be 0
Examples: exit
          exit 1`,
            internal: true,
            alias: "cls",
            /**
             * @param d
             * @param {Object|SnowflakeShell|null} shell
             * @return {[string,any,number]}
             */
            exec: (d, shell) => {
                if (typeof shell === "object" && shell.constructor.name === "SnowflakeShell") {
                    const { args } = d;
                    const exit_code = Math.max(parseInt(args[0] ?? 0) || 0, 0);
                    shell.exit(exit_code);
                }
                return ["", null, 4];
            }
        });
        this.command("info", {
            exec: (args) => {
                return [this.getInfo(args), "", 0];
            },
            help: `Get all the information about the running application.
Usage: info [?FILTERS]
    [FILTERS]:
        * Optionals
        * Default value: "all"
        * Options: "database" | "db", "app", "server", "all" | "*"

Examples: info databases
          info db
          info app server`,
            usage: "info [FILTERS]",
            internal: true
        });
        return this;
    }

    /**
     * Updates the lockdown file to reflect the current state of the blacklist.
     * This method writes the current blacklist data to a file, or removes the file if no entries are locked down.
     *
     * @return {SnowflakeCLI} - Returns the current instance of SnowflakeCLI for method chaining.
     * @since 1.0.0
     */
    #updateLockdown() {
        try {
            const file_path = this.#lockdown_file;
            if (!this.lockedDown()) {
                if (fs.existsSync(file_path))
                    fs.rmSync(file_path);
                return this;
            }
            fs.writeFileSync(file_path, JSON.stringify(this.#lockdown));
        } catch (e) {
            if (Snowflake.logger)
                Snowflake.logger.warning(".lockdown: " + e.toString());
            else
                console.log(".lockdown: " + e.toString());
        }
        return this;
    }

    /**
     * Checks whether a subject or the entire CLI is locked down.
     * By passing `null` as subject, this method will check all entries in the blacklist to determine if any are locked down.
     * The lockdown status depends on configured maximum login attempts and the lockdown mode (IP or token).
     *
     * @param {string|null} [subject=null] - The token or IP address to check for lockdown status. If `null`, all blacklist entries are checked.
     * @return {boolean} - Returns `true` if the specified subject or any blacklist entry is locked down, otherwise `false`.
     * @since 1.0.0
     */
    lockedDown(subject = null) {
        if (this.#configs.max_login_attempt <= 0)
            return false;
        if (!["ip", "token"].includes(this.#configs.lockdown))
            return false;
        const isLockedDown = s => {
            const { time, attempts } = this.#lockdown[s] ?? {};
            if (time && attempts) {
                const now = Snowflake.now(false);
                if (now <= time && attempts >= this.#configs.max_login_attempt)
                    return true;
            }
            return false;
        }

        if (subject !== null)
            return isLockedDown(subject);
        for (let [key] of Object.entries(this.#lockdown)) {
            if (isLockedDown(key))
                return true;
        }
        return false;
    }

    /**
     * Retrieves blacklist data for a given subject, such as a token or IP address.
     * If the subject is not in the blacklist, the method returns an empty object.
     *
     * @param {string} subject - The token or IP address for which to retrieve blacklist data.
     * @return {Object} - The blacklist data associated with the specified subject, or an empty object if the subject is not blacklisted.
     * @since 1.0.0
     */
    getLockdownData(subject) {
        return this.#lockdown[subject] ?? {};
    }

    /**
     * Retrieves help instructions for all commands or a specific command.
     *
     * This method generates a formatted string containing usage instructions and descriptions for commands.
     * It can provide help for all available commands, a specific command, or multiple specified commands.
     *
     * @param {string|string[]|null} [command=null] - The command or commands to retrieve help for. If `null`, help for all commands is returned. Can be a string for a single command or an array of command names.
     * @return {string} - A formatted string of help instructions for the requested command(s).
     * @since 1.0.0
     */
    getHelp(command = null) {
        let help = "";
        const getHelp = (command_name, data) => {
            if (!data)
                return "";
            const h = data.help ?? "";
            return Snowflake.logger.box(data.usage || command_name, h) + "\n";
        }
        if (command === null) {
            help += Snowflake.logger.box("@echo | @json", "Enter echo mode (for CLI) or JSON mode (for apps)") + "\n";
            help += Snowflake.logger.box("@timing on|off", "Toggle execution time measurement state.") + "\n";
            for (let [command_name, value] of Object.entries(this.#commands)) {
                help += getHelp(command_name, value);
            }
        } else {
            if (typeof command === "string") {
                help += getHelp(command, this.#commands[command] ?? false);
            } else if (typeof command === "object" && Array.isArray(command)) {
                for (let c of new Set(command)) {
                    help += getHelp(c, this.#commands[c] ?? false);
                }
            }
        }
        return help.trim();
    }

    /**
     * Retrieves information about the current application.
     *
     * This method fetches and formats key information about the application's runtime and configuration settings.
     * It is particularly useful for the 'info' command in the CLI to display details such as server uptime, version info, and database settings.
     *
     * @param {Object} data - An object containing parameters for retrieving information. It should contain an `args` property.
     * @param {Array<string>} data.args - An array of strings specifying which categories of information to retrieve. Supported values include "all", "server", "app", "db", and "database".
     * @return {string} - A formatted string containing the requested application information, encapsulated in a visual box-style.
     * @since 1.0.0
     */
    getInfo(data = {}) {
        let { args } = data;

        if (!Array.isArray(args) || args.length <= 0)
            args = ["*"];

        // Helper function to add data to the table
        const appendData = (items) => {
            table.push(...items);
        };

        // Mapping for categories and their corresponding data
        const categoryData = {
            server: [
                { key: "Uptime", value: Snowflake.secondsToClockTime(process.uptime()) },
                { key: "Webserver port", value: Snowflake.yaml.getInt("server.port") },
                { key: "CLI port", value: Snowflake.yaml.getInt("server.cli_port") },
            ],
            app: [
                { key: "Version name", value: appConfig.version },
                { key: "Version code", value: appConfig.version_code },
                { key: "Memory monitor", value: Snowflake.yaml.isTrue("memory.monitor") ? "Yes" : "No" },
                { key: "Max memory", value: Snowflake.yaml.get("memory.max_size", "N/A") },
            ],
            database: [
                { key: "MEID version", value: appConfig.meid_version },
                { key: "MEIDs count", value: Snowflake.yaml.getInt("meids.count") },
                { key: "MEIDs encryption", value: Snowflake.yaml.isTrue("meids.encrypt") ? "Yes" : "No" },
            ],
        };

        // Handle wildcard alias
        const normalizedArgs = args.map((arg) => (arg === "*" ? "all" : arg));
        const table = [];

        // Process each argument
        for (const arg of normalizedArgs) {
            if (["all", "server"].includes(arg)) {
                appendData(categoryData.server);
            }
            if (["all", "app"].includes(arg)) {
                appendData(categoryData.app);
            }
            if (["all", "db", "database"].includes(arg)) {
                appendData(categoryData.database);
            }
        }

        const tableContent = Snowflake.logger.format_color(
            Snowflake.logger.table(table, 0, "clear", "-", 0, false),
            true
        );

        return Snowflake.logger.box("Info", tableContent.trim());
    }

    /**
     * Adds a new command to the command list.
     *
     * @example
     * SnowflakeCLI.command("ls", {
     *     help: "List all existing commands.",
     *     usage: "ls [OPTIONS]",
     *     validate: d => {
     *         const {args} = d; // Get the arguments
     *         // By returning false, the command won't execute and a message will be shown to user.
     *         return Object.keys(args).length > 0; // Check if there are arguments passed
     *     },
     *     exec: d => {
     *         const {args, options} = d; // Get the arguments and options
     *         // ...
     *         return commands_list;
     *     }
     * });
     *
     * @param {string} command - The name of the command to be added.
     * @param {Object} data - The parameters providing details about the command.
     * @param {string} [data.help] - A detailed description about what the command does.
     * @param {Function} [data.validate] - A function that provides validation logic for the command. Returns a boolean indicating if the validation is successful. Defaults to always true if not provided.
     * @param {Function} [data.exec] - The function that executes the command logic. Should return an array containing a message, a value, a status code, and an output status (true or false). Defaults to returning `["", null, 0, null]` if not provided.
     * @param {boolean} [data.internal=false] - Indicates if the command is a built-in command.
     * @param {string} [data.usage] - Instructions or a template indicating how the command should be used.
     * @return {this} - Returns the current instance for method chaining.
     * @since 1.0.0
     */
    command(command, data) {
        command = String(command);
        let validateCallback = data.validate ?? null,
            execCallback = data.exec ?? null;

        if (typeof validateCallback !== "function")
            validateCallback = () => true;
        if (typeof execCallback !== "function")
            execCallback = () => ["", null, 0, null]; // message, value, statusCode, outputValue

        this.#commands[this.getOriginalCommand(command)] = Object.assign({
            help: String(data.help ?? ""),
            validate: validateCallback,
            exec: execCallback,
            internal: data.internal || false,
            usage: data.usage ?? ""
        }, this.#commands[command] ?? {});

        return this;
    }

    /**
     * Retrieves the original command name, resolving aliases if necessary.
     *
     * If an alias is provided as the `command_name`, this method returns the original command name associated with that alias.
     * If there is no alias, it simply returns the `command_name` itself.
     *
     * @example
     * // Assuming 'start' is an alias for the original command 'launch'.
     * SnowflakeCLI.getOriginalCommand('start'); // Output: 'launch'
     *
     * // If there is no alias, the original command name is returned.
     * SnowflakeCLI.getOriginalCommand('stop'); // Output: 'stop'
     *
     * @param {string} command_name - The name of the command or its alias.
     * @return {string} - The original command name if an alias was provided, otherwise returns the input `command_name`.
     *
     * @since 1.0.0
     */
    getOriginalCommand(command_name) {
        return this.#aliases[command_name] ?? command_name;
    }

    /**
     * Creates an alias for a specific command.
     *
     * @param {string} alias_name - The alias to assign to the target command.
     * @param {string} target_command - The command that the alias will point to.
     * @returns {this} - Returns the current instance for method chaining.
     *
     * @example
     * SnowflakeCLI.alias('delete', 'remove'); // Creates an alias 'delete' for the 'remove' command.
     *
     * @description
     * The `alias` method allows assigning an alternative name (`alias_name`)
     * for an existing command (`target_command`). This makes it easier to use
     * or customize command names for the CLI users. Aliases are stored internally
     * in the `#aliases` object.
     * @since 1.0.0
     */
    alias(alias_name, target_command) {
        this.#aliases[alias_name] = target_command;
        return this;
    }

    /**
     * Parses a command-line input string into a structured command with arguments and options.
     *
     * This method takes an input string containing a command, optional arguments, and options,
     * and returns an object that separates these components for easier processing.
     *
     * @example
     * const parsed = SnowflakeCLI.parseCommand('deploy --env=production --force -v "my app"');
     * console.log(parsed);
     * // Output: {
     * //   command: 'deploy',
     * //   args: ['my app'],
     * //   options: { env: 'production', force: true, v: true }
     * // }
     *
     * @param {string} input - The input command-line string to be parsed.
     *
     * @return {Object} - An object with `command`, `args`, and `options` properties:
     *   - `command` is a string representing the command name.
     *   - `args` is an array of strings representing the arguments.
     *   - `options` is an object where keys are option names and values are either true or the option's value.
     *
     * @since 1.0.0
     */
    parseCommand(input) {
        const result = {
            command: '',
            args: [],
            options: {},
        };

        // Regular expression to match arguments and options
        const regex = /"([^"]*)"|'([^']*)'|--(\S+)=(\S+)|--(\S+)|-(\S)|(\S+)/g;

        const matches = [...input.matchAll(regex)];

        matches.forEach((match) => {
            if (result.command === '') {
                // The first match is the command
                result.command = match[0];
            } else if (match[3] && match[4]) {
                // Named option with value (e.g., --key=value)
                result.options[match[3]] = match[4];
            } else if (match[5]) {
                // Named option without value (e.g., --all)
                result.options[match[5]] = true;
            } else if (match[6]) {
                // Single character option (e.g., -a)
                result.options[match[6]] = true;
            } else if (match[1] || match[2]) {
                // Quoted argument (e.g., "arg with spaces")
                result.args.push(match[1] || match[2]);
            } else if (match[7]) {
                // Plain argument
                result.args.push(match[7]);
            }
        });

        return result;
    };

    /**
     * Executes a command based on the input string.
     *
     * This method parses the input command string, validates it, and executes the corresponding command if valid.
     * It returns an array containing a message, a value, a status code, and an optional output.
     *
     * @example
     * // Assuming a command 'get' is defined and valid.
     * const [message, value, status, output] = SnowflakeCLI.exec('get key1 key2');
     * console.log(message, value, status, output); // "Found 2 entries", { "key1": "value1", "key2": "value2" }, 0, true
     *
     * @param {string} input - The input command-line string to be executed.
     * @param {SnowflakeShell|null} [shell=null] - The shell instance where the command is to be executed, if applicable.
     *
     * @return {Array} - Returns an array with four elements:
     *   - `message` (string): The result message of the command execution.
     *   - `value` (any): The result value from the command execution, or `null`.
     *   - `status` (number): A status code indicating success (0) or various errors (e.g., 3 for command not found, 4 for validation failure, 5 for execution errors). See Snowflake.getStatus() for more details.
     *   - `output` (any): Whether you want to print the value inside shell. Unless you're using JSON mode in CLI, you may need this, expected values: true or false
     *
     * @since 1.0.0
     */
    exec(input, shell = null) {
        let message = "", value = null,
            status = 0, output = null;
        try {
            const command_data = this.parseCommand(input);
            const { command, args, options } = command_data;
            if (!command || typeof this.#commands[command] !== "object")
                return ["Command not found", null, 3, null]; // message, value, status_code, output
            const { validate, exec } = this.#commands[command];
            if (typeof validate === "function" && !validate(command_data, shell)) {
                message = `command is not valid\ntry: 'help ${command}'\n`;
                status = 4;
            } else if (typeof exec === "function") {
                try {
                    const response = exec(command_data, shell);
                    if (Array.isArray(response))
                        [message, value, status, output] = response;
                } catch (e) {
                    console.log("Command execution error:", e);
                    message = e.toString();
                    value = null;
                    status = 5;
                }
            }
        } catch (e) {
            console.log("Command parse error:", e);
            message = e.toString();
            value = null;
            status = 5;
        }
        return [message, value, status, typeof output === undefined ? null : output];
    }

    /**
     * Starts the CLI server on the specified port.
     *
     * This method initializes and configures the CLI server, setting up event listeners
     * and handling connections, login attempts, and session management.
     *
     * @param {number} cli_port - The port number on which the CLI TCP server should listen.
     * @return {SnowflakeCLI} - The current instance of SnowflakeCLI for method chaining.
     * @since 1.0.0
     */
    start(cli_port) {

        try {
            if (fs.existsSync(this.#lockdown_file)) {
                const content = fs.readFileSync(this.#lockdown_file).toString("utf-8");
                this.#lockdown = JSON.parse(content);
                this.#updateLockdown();
            }
        } catch (e) {}

        this.#configs.log_connections = Snowflake.yaml.isTrue("logs.save_cli_connections");
        this.#configs.log_logins = Snowflake.yaml.isTrue("logs.save_cli_logins");
        this.#configs.lockdown = Snowflake.yaml.get("server.cli_lockdown");
        this.#configs.cooldown = Math.max(Snowflake.yaml.getInt("server.cli_cooldown"), 5);
        this.#configs.authentication_timeout = Math.max(Snowflake.yaml.getInt("server.cli_authentication_timeout"), 1000);
        this.#configs.max_login_attempt = Math.max(Snowflake.yaml.getInt("server.max_cli_login_attempt"), 0);

        Snowflake.logger.log("%cyan%[CLI] Starting TCP server for CLI...");
        SnowflakeEvents.emit("cli_server_before_init");

        SnowflakeEvents.on("cli_server_connection_error", args => {
            /**
             * @type {SnowflakeShell}
             */
            const shell = args.shell;
            this.#connections.delete(shell.uuid);
            if (shell.socket.readyState !== "closed")
                shell.socket.end();
        });

        SnowflakeEvents.on("cli_server_connection_end", args => {
            /**
             * @type {SnowflakeShell}
             */
            const shell = args.shell;
            this.#connections.delete(shell.uuid);
            if (typeof shell.token === "string") {
                if (this.#sessions.has(shell.token))
                    this.#sessions.set(shell.token, Math.max(this.#sessions.get(shell.token) - 1, 0));
            }

            Snowflake.logger.log(`%orange%[CLI]%reset% Client %underline%${shell.uuid}%reset% disconnected.`);
            if (this.#configs.log_connections) {
                const log = `[${Snowflake.logger.get_time()}] [LEAVE], Client '${shell.uuid}' disconnected.` + "\n";
                Snowflake.logger.logFile(log, "connections", true);
            }
        });

        SnowflakeEvents.on("cli_server_login_attempt", args => {
            /**
             * @type {SnowflakeShell}
             */
            const shell = args.shell;
            const { success, token, cause } = args;
            if (this.#configs.max_login_attempt > 0) {
                if (!success) {
                    const subject = this.#configs.lockdown === "ip" ? shell.socket.remoteAddress : token;
                    if (subject || typeof subject === "string") {
                        if (typeof this.#lockdown[subject] !== "object")
                            this.#lockdown[subject] = {}
                        this.#lockdown[subject]["time"] = Snowflake.now(false) + this.#configs.cooldown * 1000;
                        this.#lockdown[subject]["attempts"] = (this.#lockdown[subject]?.attempts || 0) + 1;
                    }
                    if(cause === "lockdown")
                        this.#updateLockdown();
                }
            }
            if (this.#configs.log_logins) {
                const log = `[${Snowflake.logger.get_time()}] ${success ? "Succeed" : "Failed"}, ` +
                    `Token: '${token}', IP: ${shell.socket.remoteAddress || "N/A"}${cause ? `, Cause: ${cause}` : ""}` +
                    `, UUID: ${shell.uuid}` + "\n";
                Snowflake.logger.logFile(log, "logins", true);
            }
        });

        SnowflakeEvents.on("cli_server_shell_authorized", args => {
            const { token } = args;
            if (this.#sessions.has(token))
                this.#sessions.set(token, this.#sessions.get(token) + 1);
            else
                this.#sessions.set(token, 1);
        });

        const server = createServer(socket => {

            let timeout_duration = Snowflake.yaml.getInt("server.cli_authentication_timeout", 0);

            const shell = new SnowflakeShell(this, socket, {
                mode: "echo",
                timeout: timeout_duration,
                max_input_size: Snowflake.convertSize(Snowflake.yaml.get("server.cli_input_size", 0), "B", true)
            });

            const uuid = uuid4().toString();
            this.#connections.set(shell.uuid, shell);

            Snowflake.logger.log(`%blue%[CLI]%reset% Client connected with UUID %underline%${uuid}`);

            if (this.#configs.log_connections) {
                const log = `[${Snowflake.logger.get_time()}] [JOIN], Client connected with UUID '${uuid}', IP: ${shell.socket.remoteAddress || "N/A"}` + "\n";
                Snowflake.logger.logFile(log, "connections", true);
            }

            SnowflakeEvents.emit("cli_server_connection", shell);

        });

        server.on("error", e => {
            Snowflake.logger.assert(e.toString(), 1, "CLI");
        });

        server.listen(cli_port, () => {
            Snowflake.logger.log(`%green%[CLI] CLI server started on port ${cli_port} over TCP protocol.`);
            Snowflake.logger.log(`%green%- You can connect to the CLI using \`nc [cli-host] [cli-port]\` command, e.g: \`nc 127.0.0.1 ${cli_port}\``);
            SnowflakeEvents.emit("cli_server_after_listen");
        });

        this.#tcp = server;

        return this;
    }

    /**
     * Retrieves the number of active sessions associated with a specific token.
     *
     * @example
     * const sessions = SnowflakeCLI.tokenSessions("my_token");
     * console.log(`${sessions} people are using this token right now!`);
     *
     * @param {string} token - The token for which to count the active sessions.
     * @return {number} - The number of active sessions associated with the given token, or 0 if the token is not found
     * in the sessions list.
     * @since 1.0.0
     */
    tokenSessions(token) {
        if (this.#sessions.has(token))
            return this.#sessions.get(token);
        return 0;
    }

    /**
     * Retrieves the number of active connections.
     * @return {number} - The total number of active connections.
     * @since 1.0.0
     */
    get connections() {
        return this.#connections.size;
    }

    /**
     * Retrieves the total number of active sessions across all tokens.
     * @return {number} - The total number of active sessions.
     * @since 1.0.0
     */
    get sessions() {
        let i = 0;
        this.#sessions.forEach(v => i += v);
        return i;
    }

}

module.exports = new SnowflakeCLI();