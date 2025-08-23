export default class AccessToken {

    /**
     * Token alias
     * @type {string}
     * @since 1.0.0
     */
    #alias = "";

    /**
     * Permissions list
     * @type {string[]}
     * @since 1.0.0
     */
    #permissions = [];

    /**
     * Max connections allowed for that token
     * @type {number}
     * @since 1.0.0
     */
    #maxConnections = 0;

    constructor(object) {

        if(typeof object === "object"){
            this.#alias = object.alias ?? "";
            this.#permissions = object.permissions ?? [];
            this.#maxConnections = parseInt(object.max_connections ?? 0) || 0;
        }

    }

    /**
     * Check if current token has access to specific action
     * @param {string} accessId - Access ID
     * @return {boolean}
     * @since 1.0.0
     */
    hasAccess(accessId){
        if(this.#permissions.includes("*"))
            return true;
        return this.#permissions.includes(accessId);
    }

    /**
     * Export current access data
     * @return {{alias: string, permissions: string[]}}
     * @since 1.0.0
     */
    export(){
        return {
            alias: this.#alias,
            permissions: this.#permissions
        };
    }

    /**
     * The alias of the token
     * @return {string}
     * @since 1.0.0
     */
    get alias(){
        return this.#alias;
    }

    /**
     * The list of permissions allowed for this token
     * @return {string[]}
     * @since 1.0.0
     */
    get permissions(){
        return this.#permissions;
    }

    /**
     * The maximum connections allowed for this token
     * @return {number}
     */
    get maxConnections(){
        return this.#maxConnections;
    }

}