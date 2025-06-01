const SnowflakeYaml = require("./src/core/SnowflakeYaml");
const SnowflakeServer = require("./src/core/SnowflakeServer");
const SnowflakeCoreHelper = require("./src/core/SnowflakeCoreHelper");
const SnowflakeLogger = require("./src/core/SnowflakeLogger");
const Snowflake = require("./src/core/Snowflake");

const path = require("path");
const appConfig = require("./app.json");

Snowflake.core_path = Snowflake.resolvePath("src/core");

module.exports = {
    Snowflake,
    startSnowflake: (configs_yaml = null, app_config = null) => {

        // Configuration core for making your app customizable
        const yaml = SnowflakeYaml.fromFile(configs_yaml === null ? path.join(process.cwd(), "configs.yaml") : configs_yaml);
        Snowflake.yaml = yaml;

        if(app_config === null)
            app_config = appConfig;

        // Logger core for logging
        const logger = new SnowflakeLogger(yaml.get("logs"));
        Snowflake.logger = logger;

        // Validate app configs
        let is_app_valid = true;
        const validate = {
            "signature": v => v.length !== 8 ? "app.json: Property 'signature' must be exactly 8 characters long." : true,
            "meid_version": v => Boolean(v),
            "access_keys": v => {
                if(!Object.entries(v).length)
                    logger.warning("app.json: Property 'access_keys' is empty, you won't be able to connect until you add an access key");
                return true;
            }
        };
        for(let [i, callback] of Object.entries(validate)){
            let is_valid = true, msg = `app.json: Property '${i}' is missing or invalid.`;
            if(typeof app_config[i] === "undefined" || !app_config[i]){
                is_valid = false;
            }
            else{
                const v = callback(app_config[i]);
                if(v !== true) {
                    if(typeof v === "string" && v.length)
                        msg = v;
                    is_valid = false;
                }
            }
            if(!is_valid) {
                logger.warning(msg);
                is_app_valid = false;
            }
        }

        // Stop the app if config file is invalid
        if(!is_app_valid)
            logger.assert("app.json: Failed to start the application.");

        // Main core for handling database and file systems
        const core = SnowflakeCoreHelper;
        Snowflake.core = core;

        // Server core for making HTTP webserver and websockets
        const server = SnowflakeServer;
        Snowflake.server = server;

        // Start the server (Websocket and HTTP server)
        server.start();

        // Start main core (database and app initialization)
        core.start();
    }
};