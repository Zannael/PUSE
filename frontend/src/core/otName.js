export function validateOtName(value) {
    if (typeof value !== 'string') throw new Error('Original Trainer name must be text');
    const name = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
    if (name.length < 1 || name.length > 7) {
        throw new Error('Original Trainer name must contain 1 to 7 characters');
    }
    if (/[^A-Za-z0-9 !?.'-]/.test(name)) {
        throw new Error("Original Trainer name supports letters, numbers, spaces and ! ? . - '");
    }
    return name;
}
