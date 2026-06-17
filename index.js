const { startSnowflake} = require("./module");

// TODO: Add events in different locations of app
// TODO: Disallow using the same database files from two different processes

startSnowflake("configs.yaml");