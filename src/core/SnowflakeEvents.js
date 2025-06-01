const events = require("events");

/**
 * @class SnowflakeEvents
 * @description Snowflake core for events handling
 * @since 1.0.0
 */
class SnowflakeEvents {

    /**
     * Event emitter object
     * @type {null|EventEmitter}
     * @since 1.0.0
     */
    #event_app = null;
    constructor() {
        this.#event_app = new events.EventEmitter();
    }

    /**
     * Add new event
     * @param {string|symbol} event - Event name
     * @param {any} callback - Event callback
     * @return {SnowflakeEvents}
     * @since 1.0.0
     */
    on(event, callback){
        this.#event_app.on(event, callback);
        return this;
    }

    /**
     * Synchronously calls each of the listeners registered for the event
     * @param {string|symbol} event - Event name as string or symbol
     * @param {any} args - Event arguments to pass to the event callback(s)
     * @return {boolean} - Returns true if the event had listeners, false otherwise
     * @since 1.0.0
     */
    emit(event, ...args){
        return this.#event_app.emit(event, ...args);
    }

    /**
     * Set event emitter object
     * @param {EventEmitter} eventEmitter
     * @return {SnowflakeEvents}
     * @since 1.0.0
     */
    set(eventEmitter){
        if(eventEmitter.constructor.name === "EventEmitter")
            this.#event_app = eventEmitter;
        return this;
    }
}

module.exports = new SnowflakeEvents();