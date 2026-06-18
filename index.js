/*
 * This file runs a minimal SnowflakeDB setup with default configuration.
 * If you intend to run it in your own project, use npm package or module.js file.
 */

const { startSnowflake} = require("./module");

startSnowflake("configs.yaml");