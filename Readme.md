![Beta](https://img.shields.io/badge/pre_release-pink)
![SnowflakeDB](https://img.shields.io/badge/snowflake-db-purple)
![Project Status: Incomplete](https://img.shields.io/badge/status-incomplete-red)
![Coverage](https://img.shields.io/badge/covergage-50%25-blue)

<!-- TOC -->
* [SnowflakeDB - Introduction](#snowflakedb---introduction)
  * [How to install?](#how-to-install)
    * [1. Open the project](#1-open-the-project)
    * [2. Install dependencies](#2-install-dependencies)
    * [3. Run the program](#3-run-the-program)
    * [Change the configuration (optional):](#change-the-configuration-optional)
    * [Use the program as module](#use-the-program-as-module)
  * [Benchmark (for database with only 1 entry)](#benchmark-for-database-with-only-1-entry)
    * [Data manipulation](#data-manipulation)
    * [Performance](#performance)
  * [How does it work?](#how-does-it-work)
  * [Why should I use this one?](#why-should-i-use-this-one)
  * [How to use command line (TCP shell)?](#how-to-use-command-line-tcp-shell)
    * [1. Set up your access keys](#1-set-up-your-access-keys)
    * [2. Enter your shell](#2-enter-your-shell)
    * [3. Enter your access key](#3-enter-your-access-key)
    * [4. Done!](#4-done)
  * [Configuration](#configuration)
  * [Learn more](#learn-more)
    * [Database files (MEIDs)](#database-files-meids)
    * [Key files](#key-files)
    * [TCP shell](#tcp-shell)
    * [Attributes](#attributes)
    * [Internal commands](#internal-commands)
    * [Database commands](#database-commands)
  * [Contribution](#contribution)
  * [Copyright](#copyright)
  * [License](#license)
<!-- TOC -->

# SnowflakeDB - Introduction
SnowflakeDB is an advanced in-memory database system inspired by Redis.
With SnowflakeDB, you can create a database inside your machine's RAM, which improves read and write operations on your application.

## How to install?
At this moment, this project is not final and needs more time to be ready. If you want to test it, follow this instruction:

### 1. Open the project
Run the following command or download the repository as zip:<br/>
```bash
git clone https://github.com/Ho3ein83/snowflake-db
```
Open the project directory:<br/>
```bash
cd snowflake-db
```

### 2. Install dependencies
To install the project dependencies, run the following command inside `snowflake-db` directory:<br/>
```bash
npm install
```

### 3. Run the program
After installing required dependencies, run the project using the following command:<br/>
```bash
node index.js
```
<br/>
Now you can access the database using TCP shell or use shared method to use it inside your project.

### Change the configuration (optional):
If you want to customize the application, open `configs.yaml` file and edit it as needed. See the config sections for more details.

### Use the program as module
if you have another Node.js project, and you want to run SnowflakeDB on top of your project, use this code instead:
```javascript
const { Snowflake, startSnowflake} = require("./module");

/* ... Your code here ... */

// Call this before using the database (running this at top is recommended)
// Note that it blocks your code until the database initialization is over,
// this behaviour will be changed in the first release
startSnowflake();

/* ... Your code here ... */

// Set / Update some values
Snowflake.core.set("first_name", "John");
Snowflake.core.set("last_name", "Doe");

// Get a value (with a default value)
firstName = Snowflake.core.get("first_name", "No Name");

// Delete a value
Snowflake.core.remove("last_name");

/* ... Your code here ... */
```

**Note:** as mentioned before, this project is not finished yet, so for now, you need to save the module locally inside your project.
In our case, the project was located inside the snowflake-db directory, so the module path was `./module.js`. However, you may need to set an absolute path for it to work correctly.

**Note:** there is no persistent system implemented in beta version, so your data **will be lost** when terminating the program.

## Benchmark (for database with only 1 entry)

This benchmark was done using two methods of database access: the first was a TCP shell, which allows you to manage the database via a TCP connection; the second used shared memory by integrating this project directly into your own.<br/>
Both were calculated using the same data and measurement methods on the same device.

### Data manipulation
|   Method    |   Set    |  Update  |  Delete  |   Get    | Sanitize (key) | Sanitize (value) |
|:-----------:|:--------:|:--------:|:--------:|:--------:|:--------------:|:----------------:|
|  TCP Shell  | 1.561 ms | 0.265 ms | 0.447 ms | 0.559 ms |    0.161 ms    |     0.119 ms     |
|   Shared    | 0.097 ms | 0.022 ms | 0.026 ms | 0.049 ms |    0.047 ms    |     0.002 ms     |

### Performance
|               Test                | Execution time | 
|:---------------------------------:|:--------------:|
| Initialization for empty database |   13.331 ms    |
|      Webserver and TCP start      |    2.266 ms    |
|    CLI commands initialization    |    0.002 ms    |
|         Parsing a command         |    0.565 ms    |
|           Entry lookup            |    0.004 ms    |

TCP shell commands takes longer time to execute, because there are a few extra steps for TCP connection to allow the execution, such as authenticating and validations.

**Note:** these values are based on the current version and may change on the future releases.


## How does it work?

- **Database files**:
  Each database is stored in a `.sfd` file, which contains the actual data in binary format. These database files are referred to as **MEIDs (Mapped Excluded Independent Databases)**.
  MEIDs are independent — if one becomes corrupted or gets lost, the other database parts remain usable, so you won't lose everything!

- **Database keys**:
  Each database file has a corresponding key file linked to it. The key file uses the `.sfk` format and shares the same index as the database file. For example, if a database file is named `meid-0.sfd`, the related key file will be `key-0.sfk`.<br/>
  These key files contain a list of keys, hashes, and the length of the corresponding data in the database file. They are used solely for indexing and are crucial for data recovery.<br/>
  Key files also stores as binary, which will be explained later.

- **Backup files**:
  Instead of updating each entry in the database (which can be time-consuming), SnowflakeDB tracks every change and stores it as a backup file in the `.sfb` format. These backups are later collected and merged by worker processes to persist the database. These processes run in the background and does not block the main process.<br/>
  If the application crashes while taking or restoring a backup, it won’t cause any issues, as all operations are handled in order.

- **Encode / Decode**:
  It uses msgpack for encoding and decoding data into binary, which supports various data types such as numbers, strings, booleans, objects and arrays.

- **TCP Shell**:
  SnowflakeDB provides a simple TCP shell that allows you to manage your database over a TCP connection, all you have to do is set the TCP port (or use the default) and run the following command in your terminal:<br/>
  `nc 127.0.0.0 6401` or `nc domain.com 6401`<br/>
  *Note that you might need an access token (if configured one) to access the shell.*

![Snowflake shell](https://amatris.ir/cdn/images/snowflake-db-tcp-shell.png)

- **Security**:
  There are several security options. For instance, you can set up one or more access tokens to authenticate the shell and run commands.
  You can also encrypt your data using your own encryption key, change the default ports to enhance database security and change the login attempts limit to prevent brute-force attacks.

- **Logs**:
  If you enable the logging option (enabled by default), you can track login attempts, connections, and other activities. It worth mentioning that you can customize logging options, which will be explained later.

## Why should I use this one?
There are many in-memory database and cache systems such as Redis, Memcached, and Valkey that you can use. However, in this project, simplicity is considered an important factor; therefore, there aren't many complicated data types or structures.

In addition, you get a lot of customization options, such as memory management, encryption, security features, and authentication levels.

## How to use command line (TCP shell)?
### 1. Set up your access keys
To use the TCP shell for managing your database, you first need to create your access key(s). To do this, open the `app.json` file located in the `snowflake-db` directory.
By default, the access key is empty, which means you can leave the access token field blank to access the database:
```json
"access_keys": {
    "": {
        "alias": "admin",
        "permissions": ["*"],
        "max_connections": -1
    }
}
```
To change this, simply replace the empty string with your own custom key:
```json
"access_keys": {
    "my-access-token": {
        "alias": "admin",
        "permissions": ["*"],
        "max_connections": -1
    }
}
```
You can also add more than one token with different permissions:
```json
"access_keys": {
    "my-access-token": {
        "alias": "admin",
        "permissions": ["*"],
        "max_connections": -1
    },
    "xjZApfk84NfiD10p": {
        "alias": "SnowflakeDB",
        "permissions": ["set", "get", "remove"],
        "max_connections": -1
    }
}
```
**Note:** permissions are not available in pre-release version!<br/>
To limit the maximum allowed connections, set the `max_connections` property to a positive number. To allow unlimited connections, leave it set to `-1`.

---

### 2. Enter your shell
To open the TCP shell, use the netcat command to connect to the configured TCP port and host and start the session:<br/>
```bash
nc localhost 6401
```
or:
```bash
nc host.com 6401
```
<br/>

### 3. Enter your access key
After opening the connection, enter one of your access keys and press Enter.<br/>
You have only 5 seconds to enter your access key; otherwise, the connection will be terminated, and you’ll need to reconnect.<br/>
See `server.cli_authentication_timeout` in `configs.yaml` for configuration.

### 4. Done!
Now you can enter any available command or run `help` to get the list of existing commands with usage.
![CLI help command](https://amatris.ir/cdn/images/tcp-cli-help-command.png)

## Configuration
To change the database configuration, refer to the `configs.yaml` file, which is already documented within the file itself.

## Learn more
If you're interested in how this software works, read the following sections. You’re also welcome to explore the codes.

### Database files (MEIDs)
By default, database files are located in the `snowflake-db/db` directory (this can be changed in the configuration file). These files are stored in binary format, so you can use tools like **Hexdump** or **[GHex](https://flathub.org/apps/org.gnome.GHex)** to view their contents.
If you open a MEID (`.sfd`) file, you see something like this:
```
00 01 51 62 34 53 44 36 78 46 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
8d 06 90 bf e5 07 7b 8c bf da 75 e9 02 72 65 8a
9b 82 21 d0 2b 20 90 fc 8c 4d 32 75 25 9e 7e 85
00 00 00 06 76 61 6C 75 65 31
```
The first 32 bytes make up the file header, which contains the MEID version and application signature used later for backward compatibility:
```
00 01 51 62 34 53 44 36 78 46 00 00 00 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```
The database begins immediately after the header, so the first 32 bytes of data represent the key hash of the next entry:
```
8d 06 90 bf e5 07 7b 8c bf da 75 e9 02 72 65 8a
9b 82 21 d0 2b 20 90 fc 8c 4d 32 75 25 9e 7e 85
```
The next 4 bytes represent the length of the value, which can be up to 2³² bytes, allowing you to store up to 4 GB of data in each entry. In this case, the data length is only 6 bytes:
```
00 00 00 06
```
This means the next 6 bytes contain the actual data:
```
76 61 6C 75 65 31
```
Now if you decode that into its actual format, you get the string value of `"value1"` which is the data of that entry.<br/>
If there are additional entries, they follow this value, and the process repeats.

### Key files
When you open a key file (with the `.sfk` extension), you’ll see a similar structure: the first 256 bits are the header, followed by a 256-bit hash, then a 32-bit value indicating the key length, and finally the actual key value.

### TCP shell
The TCP shell is a simulated terminal with an authentication system. It uses ANSI codes to display colored text. It uses a simple command parser to handle commands effectively.<br/>
You can also disable the TCP shell or change its port if needed, also possible to integrate your own commands into it.

### Attributes
You can use `@echo` and `@json` attributes to set the mode of the current connection. If you’re building a web interface for your database, you should send `@json` attribute immediately after authentication is completed.<br/>
For CLI don't change the attribute or send `@echo` to change it back to CLI mode.
```
╭ @echo | @json ────────────────────────────────────╮
│ Enter echo mode (for CLI) or JSON mode (for apps) │
╰───────────────────────────────────────────────────╯
```

---

To see how long a command takes to execute, enable the timing attribute by sending `@timing on`. To disable it, send `@timing off`.
```
╭ @timing on|off ──────────────────────────╮
│ Toggle execution time measurement state. │
╰──────────────────────────────────────────╯
```

### Internal commands
```
╭ help ───────────────────────────────────────────────────────────╮
│ Get the list of existing commands with usage                    │
│ Usage: help [?COMMANDS]                                         │
│     [COMMANDS]:                                                 │
│         * Optional                                              │
│         * Space separated commands you want to know more about. │
│ Examples: help                                                  │
│           help command1                                         │
│           help command1 command2                                │
│           help clear get set                                    │
╰─────────────────────────────────────────────────────────────────╯
```

```
╭ clear ──────────────────────────────────╮
│ Clears your screen if this is possible. │
│ Alias: cls                              │
╰─────────────────────────────────────────╯
```
```
╭ exit ───────────────────────────────────────────────────────────────────╮
│ Exit the shell                                                          │
│ Usage: exit [?STATUS]                                                   │
│     [STATUS]:                                                           │
│     * Optional                                                          │
│     * Exits the shell with a status. If [STATUS] is omitted or invalid, │
│       the exit status will be 0                                         │
│ Examples: exit                                                          │
│           exit 1                                                        │
╰─────────────────────────────────────────────────────────────────────────╯
```
```
╭ info [FILTERS] ────────────────────────────────────────────────────╮
│ Get all the information about the running application.             │
│ Usage: info [?FILTERS]                                             │
│     [FILTERS]:                                                     │
│         * Optionals                                                │
│         * Default value: "all"                                     │
│         * Options: "database" | "db", "app", "server", "all" | "*" │
│                                                                    │
│ Examples: info databases                                           │
│           info db                                                  │
│           info app server                                          │
╰────────────────────────────────────────────────────────────────────╯
```
Output of the `info` command:
```
╭ Info ────────────────────╮
│ Uptime ----------- 15:37 │
│ Webserver port --- 6401  │
│ CLI port --------- 6402  │
│ Version name ----- 1.0.0 │
│ Version code ----- 1     │
│ Memory monitor --- Yes   │
│ Max memory ------- 10MB  │
│ MEID version ----- 1     │
│ MEIDs count ------ 1     │
│ MEIDs encryption - No    │
╰──────────────────────────╯
```

### Database commands
```
╭ get [KEYS] ──────────────────────────────────────────────────────────╮
│ Get existing entries from memory.                                    │
│ Usage: get [KEYS] [?OPTIONS]                                         │
│     [KEYS]:                                                          │
│     * Required                                                       │
│     * Description: single key or space separated key list.           │
│     [OPTIONS]:                                                       │
│     * Optional                                                       │
│     * Options: -j or --json: force it to return JSON even for single │
│                              values.                                 │
│                                                                      │
│ Examples: get key_1                                                  │
│           get -j key_1                                               │
│           get key_1 key_2                                            │
│           get "key 1" "key 2"                                        │
│           get "key 1" -j                                             │
╰──────────────────────────────────────────────────────────────────────╯
```
```
╭ set [KEY_PAIRS] [?OPTIONS] ───────────────────────────────────────────╮
│ Change an existing value inside memory or set a new one.              │
│ Usage: set [KEY_PAIRS] [?OPTIONS]                                     │
│     [KEY_PAIRS]:                                                      │
│     * Required                                                        │
│     * Description: a key name followed by target value.               │
│     [OPTIONS]:                                                        │
│     * Optional                                                        │
│     * Options: -j or --json: by passing this option, you can set      │
│                              entries using JSON. By passing this      │
│                              option you must provide a valid JSON set │
│                              with a valid key and value.              │
│                                                                       │
│ Examples: set key1 value1                                             │
│           set key1 "value 1"                                          │
│           set key1 value1 key2 value2                                 │
│           set -j '{"key": "value"}'                                   │
│           set '{"key1": "value1"}' '{"key2": "value2"}' -j            │
│           set '{"item1": 1, "item2": 2}' --json                       │
╰───────────────────────────────────────────────────────────────────────╯
```
```
╭ delete [KEYS] ─────────────────────────────────────────────╮
│ Remove an existing value from memory or set a new one.     │
│ Usage: delete [KEYS]                                       │
│     [KEYS]:                                                │
│     * Required                                             │
│     * Description: single key or space separated key list. │
│                                                            │
│ Examples: delete key1                                      │
│           remove key1                                      │
│           delete key1 key2                                 │
│           delete "Key 1" "Key 2"                           │
╰────────────────────────────────────────────────────────────╯
```
```
╭ sanitize [TYPE] [INPUT] ────────────────────────────────────────────╮
│ Sanitize a key or value.                                            │
│ Usage: sanitize [TYPE] [INPUT] [?OPTIONS]                           │
│     [TYPE]:                                                         │
│     * Required                                                      │
│     * Description: Case insensitive type, it can be either 'key' or │
│                    'value'                                          │
│     [INPUT]:                                                        │
│     * Required                                                      │
│     * Description: The input string                                 │
│                                                                     │
│     [OPTIONS]:                                                      │
│     * Optional                                                      │
│     * Options: -t or --trim: by passing this option, you can trim   │
│                              every underscore (_) from the key      │
│                                                                     │
│ Examples: sanitize key my_key                                       │
│           sanitize KEY My key                                       │
│           sanitize Key "My key"                                     │
│           sanitize value "My value"                                 │
│           sanitize Value value                                      │
╰─────────────────────────────────────────────────────────────────────╯
```

## Contribution
We welcome and appreciate all contributions to this project! Whether it's fixing bugs, improving documentation, suggesting new features, or submitting pull requests, your input helps make the project better for everyone. If you have ideas, questions, or improvements, don't hesitate to open an issue or contribute directly.

## Copyright
This project is released with the intention of being freely usable by anyone for any purpose. You are welcome to copy, modify, redistribute, and use this project in any way you want — commercial or personal — without restriction.

## License
Read `License.txt` for details
