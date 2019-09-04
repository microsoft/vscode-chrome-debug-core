export class JSONObject {
    private constructor(jsonProperties: unknown) {
        Object.assign(this, jsonProperties);
    }

    public static create<T>(jsonProperties: T): JSONObject & T {
        return <JSONObject & T>new JSONObject(jsonProperties);
    }

    public toString(): string {
        return JSON.stringify(this);
    }
}

export function addCustomToStringToJSON<T>(jsonObject: T): T & JSONObject {
    return JSONObject.create(jsonObject);
}
