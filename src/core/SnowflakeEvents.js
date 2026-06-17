const events = require("events");

/**
 * @class SnowflakeEvents
 * @description Snowflake event bus
 * @since 1.0.0
 */
class SnowflakeEvents {

    /**
     * Event emitter object
     * @type {null|EventEmitter}
     * @since 1.0.0
     */
    eventEmitter = null;

    /**
     * @type {{ [filterId: string]: [value: any, priority: number] }}
     * @since 1.0.0
     */
    #filters = {};

    /**
     * The list of functions that'll be called on startup, use it to add your custom events, since restarting removes
     * all the events.
     * @type {function[]}
     * @since 1.0.0
     */
    #entryPoints = [];

    /**
     * The list of functions that'll be called on exit, use it to clean up your apps and modules to prevent memory leaks
     * when restarting the app.
     * @type {function[]}
     * @since 1.0.0
     */
    #exitPoints = [];

    constructor() {
        this.clearEvents();
    }

    /**
     * Adds a new event
     * @param {SnowflakeEventType|symbol} event - Event name
     * @param {function} callback - Event callback
     * @return {SnowflakeEvents} - Use for method chaining
     * @since 1.0.0
     */
    on(event, callback){
        this.eventEmitter.on(event, callback);
        return this;
    }

    /**
     * Adds a one-time event listener
     * @param {SnowflakeEventType|symbol} event - Event name
     * @param {function} callback - Event callback
     * @returns {SnowflakeEvents} - Use for method chaining
     * @since 1.0.0
     */
    once(event, callback){
        this.eventEmitter.once(event, callback);
        return this;
    }

    /**
     * Synchronously calls each of the listeners registered for the event
     * @param {SnowflakeEventType|symbol} event - Event name as string or symbol
     * @param {any} args - Event arguments to pass to the event callback(s)
     * @return {boolean} - Returns true if the event had any listeners, false otherwise
     * @since 1.0.0
     */
    emit(event, ...args){
        return this.eventEmitter.emit(event, ...args);
    }

    /**
     * Returns the number of listeners listening to the event
     * @param {SnowflakeEventType|symbol} eventName - Event name as string or symbol
     * @return {number} - The number of listeners listening to the event
     * @since 1.0.0
     */
    getListenerCounts(eventName){
        return this.eventEmitter.listenerCount(eventName, null);
    }

    /**
     * Get a specific value with the highest priority from filter list, can be used to change the behaviour of database.
     * @param {string} filterName
     * @param {boolean|string|number|null|undefined|array|object} defaultValue
     * @param {any} args
     * @returns {boolean|string|number|null|undefined|array|object}
     * @since 1.0.0
     */
    filter(filterName, defaultValue, ...args){

        // Find the filter if it exists
        const filter = this.#filters[filterName] ?? null;

        // Filters can be deconstructed as [value, priority]
        if(Array.isArray(filter)) {

            // If filter is a callback function
            if(typeof filter[0] === "function")
                return filter[0](defaultValue, args);

            // The filter is a non-function value
            return filter[0];

        }

        return defaultValue;
    }

    /**
     * Override an existing filter or add a new one
     * @param {string} filterName
     * @param {boolean|string|number|null|undefined|array|object|((filterName: string, args: any) => any)} value - Can be any scalar value, or pass a
     * function that returns one of these types (except a function).
     * @param {number} priority - The priority of the current value, if it's less than current priority it'll be ignored.
     * @return {SnowflakeEvents} - For method chaining
     * @since 1.0.0
     */
    override(filterName, value, priority = 10){

        // If overriding the filter
        if(Array.isArray(this.#filters[filterName])){

            // Deconstruct the filter, index 0 is the value, index 1 is the priority of the current filter
            const [ , currentPriority] = typeof this.#filters[filterName];

            // Requested priority is smaller than the current one
            if(currentPriority > priority)
                return this;

        }

        // Add a new filter (if didn't exist) or update the existing one
        this.#filters[filterName] = [value, priority];

        return this;

    }

    /**
     * Add a new entry point to call on startup
     * @param {function} callback
     * @since 1.0.0
     */
    addEntryPoint(callback){
        if(typeof callback === "function")
            this.#entryPoints.push(callback);
    }

    /**
     * Add a new exit point to call on exit
     * @param {function} callback
     * @since 1.0.0
     */
    addExitPoint(callback){
        if(typeof callback === "function")
            this.#exitPoints.push(callback);
    }

    /**
     * Call entry points.
     * **Note: This method is used internally and must not be used manually unless you know what you're doing.**
     * @since 1.0.0
     */
    callEntryPoints(){
        for(let callback of this.#entryPoints)
            callback();
    }

    /**
     * Call exit points.
     * **Note: This method is used internally and must not be used manually unless you know what you're doing.**
     * @since 1.0.0
     */
    callExitPoints(){
        for(let callback of this.#exitPoints)
            callback();
    }

    /**
     * Remove all event listeners.
     * **Note: This method is used internally and must not be used manually unless you know what you're doing.**
     * @return SnowflakeEvents - For method chaining
     * @since 1.0.0
     */
    clearEvents(){
        if(this.eventEmitter)
            this.eventEmitter.removeAllListeners();
        this.eventEmitter = new events.EventEmitter();
        return this;
    }

    /**
     * Clear all filters.
     * @return {SnowflakeEvents} - For method chaining
     * @since 1.0.0
     */
    clearFilters(){
        this.#filters = {};
        return this;
    }

}

const snowflakeEvents = new SnowflakeEvents();

module.exports = snowflakeEvents;