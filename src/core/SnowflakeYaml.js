const parseYaml = require("yaml");
const fs = require("fs");
const Snowflake = require("./Snowflake");

/**
 * @description Yaml parser class for Snowflake
 * @since 1.0.0
 */
const SnowflakeYaml = (function(){

    /**
     * @class SnowflakeYaml
     */
    function SnowflakeYaml(yaml_string){

        const _this = this;

        this.yaml = parseYaml.parse(yaml_string);

        /**
         * Get a property from parsed YAML string
         * @param {string|null} key - Property key to get, or pass null to get the whole YAML object
         * @param {any|null} def - Default value in case the key is missing, default is null
         * @return {any}
         * @since 1.0.0
         */
        this.get = (key = null, def = null) => {
            if(key === null)
                return this.yaml;
            if(typeof key === "string" && key.indexOf(".") >= 0){
                let result = null;
                for(let k of key.split(".")){
                    result = result === null ? (typeof this.yaml[k] !== "undefined" ? this.yaml[k] : {}) : (typeof result[k] !== "undefined" ? result[k] : {});
                }
                return result;
            }
            return this.yaml[key] || def;
        }

        /**
         * Get a config property as number
         * @param {string} key - Option key
         * @param {number} def - Default value
         * @return {number}
         * @since 1.0.0
         */
        this.getInt = (key, def=0) => {
            const n = parseInt(this.get(key, def));
            return isNaN(n) ? def : n;
        };

        /**
         * Determines if a value is considered true
         * @param {string} key - Property key
         * @return {boolean}
         * @since 1.0.0
         * @see Snowflake.isTrue()
         */
        this.isTrue = key => Snowflake.isTrue(_this.get(key));

    }

    return SnowflakeYaml;

}());

SnowflakeYaml.fromFile = file_path => new SnowflakeYaml(fs.readFileSync(file_path, "utf-8"));

module.exports = SnowflakeYaml;