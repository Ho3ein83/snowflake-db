const fs = require("fs");
const path = require("path");

/**
 * @class SnowflakeAol
 * @description Handle append only backup files
 * @since 1.0.0
 */
class SnowflakeAol {

    #queue = {};

    #backup_interval = 5000;

    constructor(database_path, permission = null) {
        this.path = database_path;
        this.file = null;
        this.current_file_name = null;
        this.file_descriptor = null;
        this.file_path = "";
        this.last_error = "";
        this.file_permission = permission;
        this.file_interval = null;
        this.instructions_changed = false;
    }

    /**
     * Serializes various data types into a string representation for backup instructions.
     *
     * @param {*} input - The input value to be converted. This can be an array, string, object, or a primitive type (number, boolean, null).
     * @returns {string} - A string representation of the input:
     *  - Arrays, strings, and objects are converted to JSON strings.
     *  - For `null`, returns 'N'.
     *  - For `true`, returns 'T'.
     *  - For `false`, returns 'F'.
     *  - Other types are converted using `toString()`.
     *  @since 1.0.0
     */
    static stringify(input) {
        if(Array.isArray(input) || typeof input === "string" || (typeof input === 'object' && input !== null))
            return JSON.stringify(input);
        if(input === null)
            return "N";
        if(input === true)
            return "T";
        if(input === false)
            return "F";
        return input.toString();
    }

    /**
     * Deserializes a string representation back into its original data type or structured format.
     *
     * @param {string} input - The string input to be parsed.
     * @returns {*} - The original data type or structure:
     *  - Returns `null` for 'N' or 'n'.
     *  - Returns `true` for 'T' or 't'.
     *  - Returns `false` for 'F' or 'f'.
     *  - Attempts to parse as JSON, if parsing fails and the input is numeric, converts to `Number`, otherwise returns as string.
     *  @since 1.0.0
     */
    static parse(input) {
        if(input === "N" || input === "n")
            return null;
        if(input === "T" || input === "t")
            return true;
        if(input === "F" || input === "f")
            return false;

        // Check if input is a quoted string and remove the surrounding quotes
        /*if((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'")))
            return input.slice(1, -1);*/

        try {
            return JSON.parse(input);
        } catch(error) {
            // If JSON.parse fails, treat it as a primitive value
            if(!isNaN(input))
                return Number(input);
            return input; // Return as string if not a number
        }
    }

    /**
     * Encodes an object of key-value pairs into a custom format for representation.
     *
     * @param {Object} data - An object representing key-value pairs to be encoded.
     * @returns {string} - A formatted string where lines represent keys sharing the same value in the format `key1<key2<...<value`.
     * @since 1.0.0
     */
    static encodeSets(data) {
        const entries = Object.entries(data);
        const encoded = [];
        const valueToKeysMap = new Map();

        entries.forEach(([key, value]) => {
            const stringValue = SnowflakeAol.stringify(value);
            if(!valueToKeysMap.has(stringValue)) {
                valueToKeysMap.set(stringValue, []);
            }
            valueToKeysMap.get(stringValue).push(key);
        });

        valueToKeysMap.forEach((keys, value) => {
            encoded.push(keys.join('<') + '<' + value);
        });

        return encoded.join('\n');
    }

    /**
     * Encodes a list of keys into a removal instruction format.
     *
     * @param {string[]} keys - An array of keys (strings) to be encoded as removal instructions.
     * @returns {string} - A formatted string with each key prefixed by `#` representing removal operations, separated by new lines.
     * @since 1.0.0
     */
    static encodeRemoval(keys) {
        return keys.map(key => `#${key}`).join('\n');
    }

    /**
     * Parses a string of mixed set and remove instructions into an ordered array of operations.
     *
     * @param {string} input - A string containing lines of instructions, which may include set operations (using `<`) and remove operations (prefixed with `#`).
     * @returns {Array} - An array of instructions:
     *  - Each `set` operation is stored as an array with `"set"` followed by an object mapping keys to their common value.
     *  - Each `remove` operation is stored as an array with `"remove"` followed by an array of keys to be removed.
     *  @since 1.0.0
     */
    static parseInstructions(input) {
        const lines = input.split('\n').map(line => line.trim()).filter(line => line !== '');
        const instructions = [];

        lines.forEach(line => {
            if(line.startsWith(';') || line === '') {
                // Ignore comments and empty lines
                return;
            }

            if(line.startsWith('#')) {
                // Remove instruction, handle multiple removals in a single line
                const keysToRemove = line.split(' ').filter(Boolean).map(key => key.slice(1));
                instructions.push("remove", keysToRemove);
            } else {
                // Set instruction
                const parts = line.split('<');
                const value = SnowflakeAol.parse(parts.pop());
                const currentSet = {};

                parts.forEach(key => currentSet[key] = value);

                instructions.push("set", currentSet);
            }
        });

        return instructions;
    }

    add(key, value){
        this.#queue[key] = value;
        this.instructions_changed = true;
        return this;
    }

    close(){
        fs.closeSync(this.file_descriptor);
        return this;
    }

    /**
     * Switch to the next backup file
     * @return {SnowflakeAol} - Current instance for method chaining
     * @since 1.0.0
     */
    rotate() {
        if(this.current_file_name === null) {
            this.current_file_name = Math.floor(Date.now() / 1000) + ".sfb";
            return this;
        }

        return this;
    }

    worker(){
        this.rotate();
        this.#make();

        if(this.file_descriptor)
            this.#jobs();
    }

    /**
     * Initialize backup files and generate them
     * @return {SnowflakeAol} - Current instance for method chaining
     * @since 1.0.0
     */
    #make() {
        try {
            this.file_path = path.join(this.path, this.current_file_name);
            this.file_descriptor = fs.openSync(this.file_path, "a");
            if(this.file_permission)
                fs.chmodSync(this.file_path, this.file_permission);
        } catch(e) {
            this.last_error = e.toString();
        }
        return this;
    }

    #jobs(){

        this.file_interval = setInterval(() => {

            // Prevent vain write attempts when no changes are made
            if(!this.instructions_changed)
                return;

            try {

                // Keep queue before clearing it
                const queue = this.#queue;

                // Ignore empty queue
                if(!Object.keys(queue).length)
                    return;

                // Clear queue to prevent new changes while writing the file
                this.#queue = {};

                // Append new instructions to current backup file
                fs.writeSync(this.file_descriptor, SnowflakeAol.encodeSets(queue) + "\n");

                // Reset changes state to prevent vain write attempts
                this.instructions_changed = false;

            } catch(e){
                console.log(e);
            }

        }, this.#backup_interval);

    }

}

module.exports = SnowflakeAol;