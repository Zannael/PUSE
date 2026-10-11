"""Validation for the seven-byte Original Trainer name field."""


def validate_ot_name(value):
    name = value.strip(" \t\r\n")
    if not 1 <= len(name) <= 7:
        raise ValueError("Original Trainer name must contain 1 to 7 characters")
    allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !?.-'"
    if any(ch not in allowed for ch in name):
        raise ValueError("Original Trainer name supports letters, numbers, spaces and ! ? . - '")
    return name
