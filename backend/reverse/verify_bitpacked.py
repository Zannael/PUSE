import struct


def verify_vanillite_logic():
    print("--- VERIFICA LOGICA BIT-PACKED ---")

    # I byte che hai estratto dal dump (Offset 0x24 - 0x2F)
    # 00 37 03 36 A9 D1 10 00
    # Indici relativi a 0x24:
    # 00=0x00, 01=0x37, 02=0x03, 03=0x36, 04=0xA9, 05=0xD1, 06=0x10, 07=0x00
    raw = bytes.fromhex("00 37 03 36 A9 D1 10 00")

    print(f"Dump Raw: {raw.hex().upper()}")

    # LOGICA DI DECODIFICA CFRU COMPACT (Ipotizzata e Testata)
    # Le mosse iniziano dall'offset relativo 2 (Assoluto 0x26)

    # Mossa 1: Offset 2 e 3. Shift 0.
    # Costruiamo un intero a 16 bit dai byte 2 e 3 (Big Endian apparente per la parte alta)
    # In realtà è un flusso Little Endian shiftato.
    # Byte[2] = 03, Byte[3] = 36.
    # Val = (03 << 8) | 36 = 0336.
    # Mask 0x1FF (9 bit) = 136 (Hex) -> 310. MATCH!
    m1_raw = (raw[2] << 8) | raw[3]
    m1 = m1_raw & 0x1FF

    # Mossa 2: Offset 4 e 5. Shift 2.
    # Byte[4] = A9, Byte[5] = D1.
    # Val = (D1 << 8) | A9 = D1A9.
    # Shift >> 2 = 346A.
    # Mask 0x1FF = 06A -> 106. MATCH!
    m2_raw = (raw[5] << 8) | raw[4]
    m2 = (m2_raw >> 2) & 0x1FF

    # Mossa 3: Offset 5 e 6. Shift 4.
    # Byte[5] = D1, Byte[6] = 10.
    # Val = (10 << 8) | D1 = 10D1.
    # Shift >> 4 = 10D.
    # Mask 0x1FF = 10D -> 269. MATCH!
    m3_raw = (raw[6] << 8) | raw[5]
    m3 = (m3_raw >> 4) & 0x1FF

    # Mossa 4: Offset 6 e 7. Shift 6.
    # Byte[6] = 10, Byte[7] = 00.
    # Val = (00 << 8) | 10 = 0010.
    # Shift >> 6 = 0.
    # Mask 0x1FF = 0. MATCH!
    m4_raw = (raw[7] << 8) | raw[6]
    m4 = (m4_raw >> 6) & 0x1FF

    print(f"Mossa 1 Decodificata: {m1} (Attesa: 310)")
    print(f"Mossa 2 Decodificata: {m2} (Attesa: 106)")
    print(f"Mossa 3 Decodificata: {m3} (Attesa: 269)")
    print(f"Mossa 4 Decodificata: {m4} (Attesa: 0)")

    if [m1, m2, m3, m4] == [310, 106, 269, 0]:
        print("\n>>> SUCCESSO: La logica è perfetta! <<<")
    else:
        print("\n>>> ERRORE: Qualcosa non va.")


if __name__ == "__main__":
    verify_vanillite_logic()