const SnowflakeYaml = require("./src/core/SnowflakeYaml");
const SnowflakeServer = require("./src/core/SnowflakeServer");
const SnowflakeCoreHelper = require("./src/core/SnowflakeCoreHelper");
const SnowflakeLogger = require("./src/core/SnowflakeLogger");
const Snowflake = require("./src/core/Snowflake");

const path = require("path");
const appConfigs = require("./app.json");
const SnowflakeCypher = require("./src/core/SnowflakeCypher");

Snowflake.core_path = Snowflake.resolvePath("src/core");

module.exports = {
    Snowflake,
    startSnowflake: (configsYaml = null, appConfiguration = null) => {

        // Configuration core for making your app customizable
        const yaml = SnowflakeYaml.fromFile(configsYaml === null ? path.join(process.cwd(), "configs.yaml") : configsYaml);
        Snowflake.yaml = yaml;

        if(appConfiguration === null)
            appConfiguration = appConfigs;

        Snowflake.isDevelopment = false;
        if(typeof appConfiguration === "object" && typeof appConfiguration.is_development === "boolean")
            Snowflake.isDevelopment = appConfiguration.is_development;

        // Logger core for logging
        const logger = new SnowflakeLogger(yaml.get("logs"));
        Snowflake.logger = logger;

        // Start the benchmark
        logger.timeStart("application");
        logger.timeStart("encryption");

        // Initialize encryption core
        const cypher = new SnowflakeCypher(Snowflake.resolvePath(Snowflake.yaml.get("meids.encryption_cypher")));

        if(Snowflake.yaml.isTrue("meids.encrypt"))
            cypher.init();

        logger.benchmark("Encryption core initialized", "encryption");

        Snowflake.cypher = cypher;

        logger.timeStart("app_validation");

        // Validate app configs
        let is_app_valid = true;
        const validate = {
            "signature": v => v.length !== 8 ? "app.json: Property 'signature' must be exactly 8 characters long." : true,
            "access_keys": v => {
                if(!Object.entries(v).length)
                    logger.warning("app.json: Property 'access_keys' is empty, you won't be able to connect until you add an access key.");
                return true;
            },
            "encryption_salt": v => {
                if(Snowflake.yaml.isTrue("meids.encrypt")){
                    if(v.length !== 32)
                    return "app.json: Property 'encryption_salt' must be exactly 32 characters.";
                }
                return true;
            }
        };

        let errors = [];
        for(let [i, callback] of Object.entries(validate)){
            let isValid = true, errorMessage = `app.json: Property '${i}' is missing or invalid.`;
            if(typeof appConfiguration[i] === "undefined" || !appConfiguration[i]){
                isValid = false;
            }
            else{
                const v = callback(appConfiguration[i]);
                if(v !== true) {
                    if(typeof v === "string" && v.length)
                        errorMessage = v;
                    isValid = false;
                }
            }
            if(!isValid) {
                errors.push(errorMessage);
                logger.warning(errorMessage);
                is_app_valid = false;
            }
        }

        logger.benchmark("Application was validated", "app_validation");

        // Stop the app if config file is invalid
        if(!is_app_valid)
            logger.assert("app.json: Failed to start the application.\n" + errors.join("\n"));

        // Main core for handling database and file systems
        const core = SnowflakeCoreHelper;
        Snowflake.core = core;

        // Server core for making HTTP webserver and websockets
        const server = SnowflakeServer;
        Snowflake.server = server;

        // Start the server (Websocket and HTTP server)
        logger.benchmarkCode(() => {
            server.start();
        }, "Server initialized");

        // Start main core (database and app initialization)
        logger.benchmarkCode(() => {
            core.start();
        }, "Database loaded");

        // Display ready message
        logger.benchmark("✓ Program started", "application");
    }
};