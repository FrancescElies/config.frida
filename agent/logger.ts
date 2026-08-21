export function log(message?: any, ...optionalParams: any[]) {
    // send({ type: "log", message, optionalParams });
    console.log(message, ...optionalParams);
}
