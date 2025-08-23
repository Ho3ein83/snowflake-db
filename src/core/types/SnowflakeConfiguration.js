/**
 * @typedef SnowflakeConfiguration
 * @property {{
 *     enabled: boolean,
 *     showTime: boolean,
 *     time_format: string,
 *     use_colors: boolean,
 *     save_cli_connections: boolean,
 *     save_cli_logins: boolean
 * }} logs
 * @property {{
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
 * }} server
 * @property {{
 *     database: string,
 *     logs: string
 * }} dir
 * @property {{
 *     enabled: boolean,
 *     backup_size_limit: string
 * }} persistent
 * @property {{
 *     encrypt: boolean,
 *     encryption_cypher: string,
 *     recover: boolean,
 *     permission: string,
 *     check_signature: boolean,
 *     count: number,
 *     max_count: number,
 *     size: string
 * }} meids
 * @property {{
 *     monitor: boolean,
 *     max_size: string,
 *     mb_mode: boolean,
 * }} memory
 * @property {{
 *     name: string,
 *     max_size: string
 * }} filesystem
 */


/**
 * @typedef {(
 * "logs.enabled" | "logs.show_time" | "logs.time_format" | "logs.use_colors" | "logs.save_cli_connections" | "logs.save_cli_logins" |
 * "server.port" | "server.cli_port" | "server.max_cli_login_attempt" | "server.cli_lockdown" | "server.cli_cooldown" | "server.cli_authentication_timeout" | "server.cli_input_size" | "server.http_server" | "server.home_page" | "server.allowed_origins" | "server.gui_host" | "server.secure_gui" |
 * "dir.database" | "dir.logs" |
 * "persistent.enabled" | "persistent.backup_size_limit" | "persistent.backup_interval" |
 * "meids.encrypt" | "meids.encryption_cypher" | "meids.recover" | "meids.permission" | "meids.check_signature" | "meids.count" | "meids.max_count" | "meids.size" |
 * "memory.monitor" | "memory.max_size" | "memory.mb_mode" |
 * "filesystem.name" | "filesystem.max_size"
 * )} SnowflakeConfigurationString
 */