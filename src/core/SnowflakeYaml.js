const parseYaml = require("yaml");
const fs = require("fs");
const Snowflake = require("./Snowflake");

/**
 * @class Yaml parser class for configuration management
 * @since 1.0.0
 */
class SnowflakeYaml {

    /**
     * Current configuration object
     * @type {object}
     * @since 1.0.0
     */
    yaml = {};

    /**
     * Whether there is any unsaved change made
     * @type {boolean}
     * @since 1.0.0
     */
    changed = false;

    constructor(yamlString) {
        this.yaml = parseYaml.parse(yamlString);
    }

    /**
     * Get a specific property from configuration object
     * @param {SnowflakeConfigurationString} key - Property key to get, or pass null to get the whole YAML object
     * @param {*} defaultValue - Default value in case the key is missing, default is null
     * @return {any}
     * @since 1.0.0
     */
    get(key, defaultValue = null) {
        if (key === null)
            return this.yaml;
        if (typeof key === "string" && key.indexOf(".") >= 0) {
            let result = null;
            for (let k of key.split(".")) {
                result = result === null
                         ? (typeof this.yaml[k] !== "undefined" ? this.yaml[k] : {})
                         : (typeof result[k] !== "undefined" ? result[k] : {});
            }
            return result;
        }
        return this.yaml[key] || defaultValue;
    }

    /**
     * Get a specific property from configuration object as integer (number)
     * @param {SnowflakeConfigurationString} key - Item key
     * @param {number} def - Default value
     * @return {number}
     * @since 1.0.0
     */
    getInt(key, def = 0) {
        const n = parseInt(this.get(key, def));
        return isNaN(n) ? def : n;
    }

    /**
     * Get formatted file size from config file. For example 1000B will be shown as "1KB" or "0.97KiB"
     * @param {SnowflakeConfigurationString} key - Item key
     * @param {boolean} mbMode - Whether to use mega-binary mode
     * @param {null|number} decimals - The number of decimals in the output size, pass null for auto
     * @param {string} defaultValue - The default size in case of failure
     * @return {string}
     * @since 1.0.0
     */
    getBytes(key, mbMode = false, decimals = null, defaultValue = "0B") {
        const size = Snowflake.convertSize(this.get(key, defaultValue));
        return Snowflake.formatBytes(size, mbMode, decimals);
    }

    /**
     * Determines if a specific value is considered true, these are the values that represent logical true:
     * - `1` (integer)
     * - `"1"` (string)
     * - `true` (boolean)
     * - `"true"` (string)
     * - `"yes"` (string)
     * - `"on"` (string)
     * - `"y"` (string)
     * @param {SnowflakeConfigurationString} key - Property key
     * @return {boolean}
     * @since 1.0.0
     * @see Snowflake.isTrue()
     */
    isTrue(key) {
        return Snowflake.isTrue(this.get(key));
    }

    /**
     * Save current configuration object in a file
     * @param {string} filePath - Target file path (with .yaml extension) to save the configuration
     * @return {SnowflakeYaml}
     * @since 1.0.0
     */
    saveAs(filePath){
        const yamlString = "# This configuration has been updated, see https://amatris.com/snowflake/docs/configuration for more details" + "\n" + parseYaml.stringify(this.yaml);
        fs.writeFileSync(filePath, yamlString);
        this.changed = true;
        return this;
    }

    /**
     * Updates current configuration file (config.yaml) using by the app with current object.
     * @return {SnowflakeYaml}
     * @since 1.0.0
     */
    save(){

        if(Snowflake.configPath) {
            Snowflake.logger.benchmarkCode(() => {
                this.saveAs(Snowflake.configPath);
            }, "Configuration saved in");
        }

        return this;
    }

    /**
     * Replaces current configuration object with another
     * @param {object} object - New configuration object
     * @return {SnowflakeYaml} - For method chaining
     * @since 1.0.0
     */
    load(object){
        this.yaml = object;
        return this;
    }

    /**
     * Merge current configuration object with another, only existing properties in the given object will be updated.
     * @param {object} objectPart - Partial or complete object to merge
     * @return {SnowflakeYaml}
     * @since 1.0.0
     */
    merge(objectPart){
        this.yaml = Object.assign(this.yaml, objectPart);
        return this;
    }

    /**
     * Creates a new `SnowflakeYaml` instance from YAML file
     * @param {string} filePath - YAML file path
     * @returns {SnowflakeYaml}
     * @since 1.0.0
     */
    static fromFile(filePath) {
        return new SnowflakeYaml(fs.readFileSync(filePath, "utf-8"));
    }

}

module.exports = SnowflakeYaml;