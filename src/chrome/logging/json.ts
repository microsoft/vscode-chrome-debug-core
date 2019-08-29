export class JSONObject {
    private constructor(jsonProperties: object) {
        Object.assign(this, jsonProperties);
    }

    public static create<T>(jsonProperties: object): JSONObject & T {
        return <JSONObject & T>new JSONObject(jsonProperties);
    }

    public toString(): string {
        return JSON.stringify(this);
    }
}

export function addCustomToStringToJSON<T>(jsonObject: object): T & JSONObject {
    return JSONObject.create(jsonObject);
}
