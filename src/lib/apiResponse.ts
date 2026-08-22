
export class ApiResponse<T = unknown> {
    success: boolean;
    message: string;
    data?: T;
    error?: unknown;

    constructor(success: boolean, message: string, data?: T, error?: unknown) {
        this.success = success;
        this.message = message;
        this.data = data;
        this.error = error;
    }

    static success<T>(data: T, message = 'Success'): ApiResponse<T> {
        return new ApiResponse(true, message, data);
    }

    static error(message: string, error?: unknown): ApiResponse<null> {
        return new ApiResponse(false, message, null, error);
    }
}
