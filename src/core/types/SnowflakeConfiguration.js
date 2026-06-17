/**
 * @typedef {{
 *     [token: string]: {
 *         alias: string,
 *         permission: string[],
 *         max_connections: number
 *     }
 * }} SnowflakeAppAccessToken
 */

/**
 * @typedef {{
 *     name: string,
 *     version: string,
 *     signature: string,
 *     encryption_salt: string,
 *     is_development: boolean,
 *     access_keys: SnowflakeAppAccessToken
 * }} SnowflakeAppConfig
 */

/**
 * @typedef {{
 *     enabled: boolean,
 *     show_time: boolean,
 *     time_format: string,
 *     use_colors: boolean,
 *     save_cli_connections: boolean,
 *     save_cli_logins: boolean
 *     benchmark: boolean,
 *     backup_logs: boolean,
 *     snapshot_logs: boolean,
 *     database_logs: boolean,
 *     server_logs: boolean,
 *     system_logs: boolean,
 *     cypher_logs: boolean,
 *     cli_logs: boolean
 *     shell_logs: boolean
 * }} SFConfigurationLogs
 */

/**
 * @typedef {{
 *     port: number,
 *     cli_port: number,
 *     max_cli_login_attempt: number,
 *     cli_lockdown: string,
 *     cli_cooldown: number,
 *     cli_authentication_timeout: number,
 *     cli_input_size: number,
 *     http_server: boolean,
 *     home_page: boolean,
 *     gui_host: string,
 *     secure_gui: boolean,
 *     allowed_origins: string
 * }} SFConfigurationServer
 */

/**
 * @typedef {{
 *     database: string,
 *     logs: string
 * }} SFConfigurationDir
 */

/**
 * @typedef {{
 *     enabled: boolean,
 *     backup_size_limit: string,
 *     backup_interval: number,
 *     snapshot_size_trigger: string,
 *     snapshot_interval: number
 * }} SFConfigurationPersistent
 */

/**
 * @typedef {{
 *     encrypt: boolean,
 *     encryption_cypher: string,
 *     recover: boolean,
 *     permission: string,
 *     check_signature: boolean,
 *     count: number,
 *     max_count: number,
 *     size: string
 * }} SFConfigurationMeids
 */

/**
 * @typedef {{
 *     monitor: boolean,
 *     max_size: string,
 *     mb_mode: boolean,
 * }} SFConfigurationMemory
 */

/**
 * @typedef {{
 *     name: string,
 *     max_size: string
 * }} SFConfigurationFileSystem
 */

/**
 * @typedef {(
 * "logs" | "logs.enabled" | "logs.show_time" | "logs.time_format" | "logs.use_colors" | "logs.save_cli_connections" | "logs.save_cli_logins" | "logs.benchmark" | "logs.backup_logs" | "logs.snapshot_logs" | "logs.database_logs" | "logs.server_logs" | "logs.system_logs" | "logs.shell_logs" | "logs.cli_logs" | "logs.cypher_logs" |
 * "server" | "server.port" | "server.cli_port" | "server.max_cli_login_attempt" | "server.cli_lockdown" | "server.cli_cooldown" | "server.cli_authentication_timeout" | "server.cli_input_size" | "server.http_server" | "server.home_page" | "server.allowed_origins" | "server.gui_host" | "server.secure_gui" |
 * "dir" | "dir.database" | "dir.logs" |
 * "persistent" | "persistent.enabled" | "persistent.backup_size_limit" | "persistent.snapshot_size_trigger" | "persistent.backup_interval" | "persistent.snapshot_interval" |
 * "meids" | "meids.encrypt" | "meids.encryption_cypher" | "meids.recover" | "meids.permission" | "meids.check_signature" | "meids.count" | "meids.max_count" | "meids.size" |
 * "memory" | "memory.monitor" | "memory.max_size" | "memory.mb_mode" |
 * "filesystem" | "filesystem.name" | "filesystem.max_size"
 * )} SnowflakeConfigurationString
 */