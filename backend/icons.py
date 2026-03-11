import sys
import os
import glob
import re
from PyQt5 import QtWidgets, QtGui, QtCore
from PyQt5.QtGui import QPixmap, QImage, QColor, QBitmap  # <--- Aggiungi QBitmap qui

# Tenta di importare Levenshtein, altrimenti usa difflib (standard)
try:
    import Levenshtein

    HAS_LEVENSTEIN = True
except ImportError:
    import difflib

    HAS_LEVENSTEIN = False
    print("[INFO] Libreria 'python-Levenshtein' non trovata. Uso 'difflib' standard.")

# --- MOCK DATABASE (Simulazione dati dal .CT) ---
# Prendo alcuni item che so esistere nella tua struttura o nel gioco
MOCK_DB_ITEMS = {
    1: "Master Ball",
    4: "Poke Ball",
    599: "Fire Gem",
    600: "Water Gem",
    601: "Grass Gem",
    55: "Life Orb",
    200: "Leftovers",
    90: "Light Clay",
    # Casi difficili per testare il fuzzy
    187: "King's Rock",  # Il file potrebbe essere Kings Rock.png
    716: "Ability Capsule"
}

# --- PERCORSO ICONE ---
# Modifica questo percorso se la cartella icons non è nella stessa directory dello script
ICONS_DIR = os.path.join(os.getcwd(), "icons", "items")


class IconManager:
    def __init__(self, root_dir):
        self.root_dir = root_dir
        self.icon_map = {}  # { normalized_name : full_path }
        self._index_icons()

    def _normalize(self, text):
        """Rimuove estensioni, caratteri speciali e mette in lowercase."""
        text = os.path.splitext(text)[0]
        text = re.sub(r'[^a-zA-Z0-9]', '', text).lower()
        return text

    def _index_icons(self):
        if not os.path.exists(self.root_dir):
            return
        for root, dirs, files in os.walk(self.root_dir):
            for file in files:
                if file.lower().endswith('.png'):
                    norm_name = self._normalize(file)
                    full_path = os.path.join(root, file)
                    self.icon_map[norm_name] = full_path

    def get_icon_path(self, item_name):
        target = self._normalize(item_name)

        # 1. Match Esatto
        if target in self.icon_map:
            return self.icon_map[target]

        # 2. Match "Contiene" (Prioritario per evitare Master Ball -> Fast Ball)
        # Cerca se 'target' è una sottostringa di qualche file
        for key in self.icon_map:
            if target in key or key in target:
                return self.icon_map[key]

        # 3. Fuzzy Match (Ultima spiaggia)
        candidates = list(self.icon_map.keys())
        if HAS_LEVENSTEIN and candidates:
            best_ratio = 0.0
            best_match = None
            for cand in candidates:
                ratio = Levenshtein.ratio(target, cand)
                if ratio > best_ratio:
                    best_ratio = ratio
                    best_match = cand
            if best_ratio > 0.7:
                return self.icon_map[best_match]

        return None

    def get_processed_pixmap(self, path):
        image = QImage(path)
        if image.isNull(): return None

        image = image.convertToFormat(QImage.Format_ARGB32)

        # Colore sfondo (pixel 0,0)
        bg_color = image.pixelColor(0, 0)

        # Crea maschera: 0 = Trasparente, 1 = Opaco
        # Qt.MaskOutColor imposta a 0 i pixel che matchano il colore (sfondo)
        mask_image = image.createMaskFromColor(bg_color.rgb(), QtCore.Qt.MaskOutColor)

        # --- FIX: INVERTIAMO LA MASCHERA ---
        # Se il risultato visivo è "oggetto bucato", invertiamo i bit.
        # Ora: Sfondo = 0 (trasparente), Oggetto = 1 (visibile)
        # Nota: A volte Qt inverte logica 0/1 su QBitmap, invertPixels corregge.
        # Se vedi ancora nero, prova a commentare questa riga, ma al 99% serve.
        mask_image.invertPixels()

        mask_bitmap = QBitmap.fromImage(mask_image)

        pixmap = QPixmap.fromImage(image)
        pixmap.setMask(mask_bitmap)

        return pixmap.scaled(48, 48, QtCore.Qt.KeepAspectRatio, QtCore.Qt.SmoothTransformation)


class TestWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Test Item Icons & Transparency")
        self.resize(600, 500)

        self.icon_mgr = IconManager(ICONS_DIR)

        central = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(central)

        # Tabella
        self.table = QtWidgets.QTableWidget()
        self.table.setColumnCount(3)
        self.table.setHorizontalHeaderLabels(["Icona (No BG)", "Nome nel DB", "File Trovato"])
        self.table.setIconSize(QtCore.QSize(48, 48))
        self.table.verticalHeader().setDefaultSectionSize(50)
        self.table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.Stretch)

        layout.addWidget(self.table)

        self.populate_table()
        self.setCentralWidget(central)

        # Stile scuro per vedere meglio la trasparenza (se funziona, lo sfondo sarà quello della tabella)
        self.setStyleSheet(
            "QTableWidget { background-color: #202020; color: white; alternate-background-color: #2a2a2a; }")

    def populate_table(self):
        self.table.setRowCount(len(MOCK_DB_ITEMS))

        for row, (item_id, item_name) in enumerate(MOCK_DB_ITEMS.items()):
            path = self.icon_mgr.get_icon_path(item_name)

            icon_item = QtWidgets.QTableWidgetItem()
            file_found_text = "Nessun file trovato"

            if path:
                pixmap = self.icon_mgr.get_processed_pixmap(path)
                if pixmap:
                    icon_item.setIcon(QtGui.QIcon(pixmap))
                file_found_text = os.path.basename(path)

            self.table.setItem(row, 0, icon_item)
            self.table.setItem(row, 1, QtWidgets.QTableWidgetItem(f"{item_name} ({item_id})"))
            self.table.setItem(row, 2, QtWidgets.QTableWidgetItem(file_found_text))


if __name__ == "__main__":
    app = QtWidgets.QApplication(sys.argv)
    win = TestWindow()
    win.show()
    sys.exit(app.exec_())