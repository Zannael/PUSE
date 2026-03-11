import sys
import shutil
import glob
import os
import struct
import math

from PyQt5 import QtWidgets, QtCore, QtGui
from PyQt5.QtGui import QPixmap, QIcon

# --- IMPORTAZIONE MODULI ESTERNI ---
import unbound_editor_v8 as party_mod
import unbound_bag_editor_v14 as bag_mod
import edit_money_v2 as money_mod
import unbound_box_editor_v16 as box_mod  # <--- AGGIORNATO ALLA V16 (Preset Box Support)

# --- LOGICA MATEMATICA EXP (GUI) ---
GROWTH_NAMES = {
    0: "Medium Fast (Cubic)", 1: "Erratic", 2: "Fluctuating",
    3: "Medium Slow", 4: "Fast", 5: "Slow"
}


def get_exp_at_level(rate_idx, n):
    if n <= 1: return 0
    if n > 100: n = 100
    if rate_idx == 0:
        return n ** 3
    elif rate_idx == 1:
        if n <= 50:
            return int((n ** 3 * (100 - n)) / 50)
        elif n <= 68:
            return int((n ** 3 * (150 - n)) / 100)
        elif n <= 98:
            return int((n ** 3 * ((1911 - 10 * n) / 3)) / 500)
        else:
            return int((n ** 3 * (160 - n)) / 100)
    elif rate_idx == 2:
        if n <= 15:
            return int(n ** 3 * ((math.floor((n + 1) / 3) + 24) / 50))
        elif n <= 36:
            return int(n ** 3 * ((n + 14) / 50))
        else:
            return int(n ** 3 * ((math.floor(n / 2) + 32) / 50))
    elif rate_idx == 3:
        return int(1.2 * (n ** 3) - 15 * (n ** 2) + 100 * n - 140)
    elif rate_idx == 4:
        return int((4 * (n ** 3)) / 5)
    elif rate_idx == 5:
        return int((5 * (n ** 3)) / 4)
    return n ** 3


def calc_current_level(rate_idx, current_exp):
    for lvl in range(1, 101):
        if current_exp < get_exp_at_level(rate_idx, lvl + 1):
            return lvl
    return 100


# --- GUI CLASS ---
class MainWindow(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Pokemon Unbound GUI Editor v2.5 (Backend v15.1 - Item Support)")
        self.resize(1200, 750)  # Leggermente più largo per colonna extra

        self.save_path = None
        self.full_data = None

        # Dati Squadra
        self.party_trainer_sections = []
        self.party_pokemon_list = []
        self.party_active_sec_off = None

        # Dati Borsa
        self.bag_candidates = []
        self.bag_anchor_offset = None
        self.bag_pocket_items = []

        # Dati PC Box
        self.pc_context = {}
        self.pc_pokemon_list = []
        self.pc_table_map = {}  # Mappa righe -> oggetti Pokemon

        # UI Setup
        central = QtWidgets.QWidget()
        main_layout = QtWidgets.QVBoxLayout(central)

        # Top Bar
        top_layout = QtWidgets.QHBoxLayout()
        self.open_btn = QtWidgets.QPushButton("Apri Save (.sav)...")
        self.open_btn.clicked.connect(self.open_save)
        self.path_label = QtWidgets.QLabel("Nessun file caricato")
        self.path_label.setStyleSheet("color: gray; font-style: italic;")
        self.path_label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        top_layout.addWidget(self.open_btn)
        top_layout.addWidget(self.path_label, 1)

        main_layout.addLayout(top_layout)

        # Tabs
        self.tabs = QtWidgets.QTabWidget()
        main_layout.addWidget(self.tabs, 1)

        self._init_trainer_tab()
        self._init_party_tab()
        self._init_pc_tab()
        self._init_bag_tab()

        self.setCentralWidget(central)
        self._apply_modern_style()

    def _apply_modern_style(self):
        base_bg = "#121212"
        panel_bg = "#1e1e1e"
        accent = "#3f8efc"
        accent_soft = "#2f5fae"
        text = "#f5f5f5"
        muted = "#aaaaaa"
        border = "#303030"

        palette = QtGui.QPalette()
        palette.setColor(QtGui.QPalette.Window, QtGui.QColor(base_bg))
        palette.setColor(QtGui.QPalette.WindowText, QtGui.QColor(text))
        palette.setColor(QtGui.QPalette.Base, QtGui.QColor("#181818"))
        palette.setColor(QtGui.QPalette.AlternateBase, QtGui.QColor("#202020"))
        palette.setColor(QtGui.QPalette.Text, QtGui.QColor(text))
        palette.setColor(QtGui.QPalette.Button, QtGui.QColor(panel_bg))
        palette.setColor(QtGui.QPalette.ButtonText, QtGui.QColor(text))
        palette.setColor(QtGui.QPalette.Highlight, QtGui.QColor(accent))
        palette.setColor(QtGui.QPalette.HighlightedText, QtGui.QColor("#ffffff"))
        self.setPalette(palette)

        self.setStyleSheet(f"""
        QMainWindow, QDialog, QMessageBox {{ background-color: {base_bg}; color: {text}; }}
        QLabel {{ color: {text}; }}
        QGroupBox {{ border: 1px solid {border}; border-radius: 8px; margin-top: 14px; padding: 8px; }}
        QGroupBox::title {{ subcontrol-origin: margin; left: 10px; padding: 0 4px; color: {muted}; }}
        QPushButton {{ background-color: {accent}; color: white; border-radius: 6px; padding: 6px 12px; border: none; font-weight: 500; }}
        QPushButton:hover {{ background-color: {accent_soft}; }}
        QPushButton:disabled {{ background-color: #444444; color: #777777; }}
        QTabWidget::pane {{ border-top: 1px solid {border}; margin-top: 2px; }}
        QTabBar::tab {{ background: {panel_bg}; padding: 8px 16px; margin-right: 2px; border-top-left-radius: 8px; border-top-right-radius: 8px; color: {muted}; }}
        QTabBar::tab:selected {{ background: {accent_soft}; color: {text}; }}
        QTableView {{ background-color: #1a1a1a; alternate-background-color: #222222; color: {text}; gridline-color: {border}; border-radius: 8px; }}
        QHeaderView::section {{ background-color: #202020; color: {muted}; padding: 4px; border: none; border-right: 1px solid {border}; }}
        QTableView::item:selected {{ background-color: {accent}; color: #ffffff; }}
        QSpinBox, QComboBox, QLineEdit {{ background-color: #181818; border: 1px solid {border}; border-radius: 4px; padding: 2px 6px; color: {text}; }}
        QComboBox QAbstractItemView {{ background-color: #181818; color: {text}; border: 1px solid {border}; }}
        """)

    # ---------- HELPER IMMAGINI ----------
    def get_pokemon_icon(self, species_id):
        if not hasattr(self, "icon_cache"):
            self.icon_cache = {}
        if species_id in self.icon_cache:
            return self.icon_cache[species_id]

        search_dirs = ["icons/pokemon", "data/icons/pokemon"]
        id_str = f"{species_id:03}"
        prefix = f"gFrontSprite{id_str}"
        found_path = None

        for folder in search_dirs:
            if not os.path.exists(folder): continue
            pattern = os.path.join(folder, f"{prefix}*.png")
            candidates = glob.glob(pattern)
            for path in candidates:
                filename = os.path.basename(path)
                # Filtra file che hanno caratteri extra dopo l'ID (es. varianti non supportate)
                remainder = filename[len(prefix):]
                if remainder and remainder[0].isdigit(): continue
                found_path = path
                break
            if found_path: break

        if found_path:
            pix = QPixmap(found_path)
            if pix.width() > 64:
                pix = pix.scaled(64, 64, QtCore.Qt.KeepAspectRatio, QtCore.Qt.SmoothTransformation)
            icon = QIcon(pix)
            self.icon_cache[species_id] = icon
            return icon
        return QIcon()

    # ---------- UI INIT ----------
    def _init_trainer_tab(self):
        self.trainer_tab = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(self.trainer_tab)
        money_group = QtWidgets.QGroupBox("Economia")
        money_layout = QtWidgets.QFormLayout()
        self.money_spin = QtWidgets.QSpinBox()
        self.money_spin.setRange(0, 9999999)
        self.money_spin.setSingleStep(1000)
        self.money_spin.setSuffix(" $")
        self.btn_save_money = QtWidgets.QPushButton("Aggiorna Soldi")
        self.btn_save_money.clicked.connect(self.save_money_changes)
        self.btn_save_money.setEnabled(False)
        money_layout.addRow("Soldi Attuali:", self.money_spin)
        money_layout.addRow("", self.btn_save_money)
        money_group.setLayout(money_layout)
        layout.addWidget(money_group)
        layout.addStretch()
        self.tabs.addTab(self.trainer_tab, "Trainer")

    def _init_party_tab(self):
        self.party_tab = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(self.party_tab)
        self.party_table = QtWidgets.QTableWidget()
        self.party_table.setColumnCount(7)
        self.party_table.setHorizontalHeaderLabels(["Icona", "Zona", "Slot", "Nickname", "Specie", "Lv", "Natura"])
        self.party_table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.Stretch)
        self.party_table.horizontalHeader().setSectionResizeMode(0, QtWidgets.QHeaderView.ResizeToContents)
        self.party_table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.party_table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.party_table.setIconSize(QtCore.QSize(64, 64))
        self.party_table.setAlternatingRowColors(True)
        self.party_table.verticalHeader().setVisible(False)
        layout.addWidget(self.party_table)

        btn_layout = QtWidgets.QHBoxLayout()
        self.btn_party_edit_nature = QtWidgets.QPushButton("Modifica Natura")
        self.btn_party_edit_ivs = QtWidgets.QPushButton("Modifica IVs")
        self.btn_party_edit_evs = QtWidgets.QPushButton("Modifica EVs")
        self.btn_party_edit_nature.clicked.connect(lambda: self.edit_nature(is_party=True))
        self.btn_party_edit_ivs.clicked.connect(lambda: self.edit_ivs(is_party=True))
        self.btn_party_edit_evs.clicked.connect(lambda: self.edit_evs(is_party=True))
        btn_layout.addWidget(self.btn_party_edit_nature)
        btn_layout.addWidget(self.btn_party_edit_ivs)
        btn_layout.addWidget(self.btn_party_edit_evs)
        layout.addLayout(btn_layout)

        btn_layout_2 = QtWidgets.QHBoxLayout()
        self.btn_party_moves = QtWidgets.QPushButton("Modifica Mosse")
        self.btn_party_item = QtWidgets.QPushButton("Modifica Strumento")
        self.btn_pc_edit_moves = QtWidgets.QPushButton("Modifica Mosse")
        self.btn_pc_edit_moves.clicked.connect(self.edit_pc_moves)  # Collega alla funzione
        self.btn_party_ability = QtWidgets.QPushButton("Gestione Abilità (HA)")
        self.btn_party_moves.clicked.connect(lambda: self.edit_moves(is_party=True))
        self.btn_party_item.clicked.connect(lambda: self.edit_item(is_party=True))
        self.btn_party_ability.clicked.connect(lambda: self.edit_ability(is_party=True))
        btn_layout_2.addWidget(self.btn_party_moves)
        btn_layout_2.addWidget(self.btn_party_item)
        btn_layout_2.addWidget(self.btn_party_ability)
        layout.addLayout(btn_layout_2)

        save_layout = QtWidgets.QHBoxLayout()
        save_layout.addStretch()
        self.btn_save_party = QtWidgets.QPushButton("Salva Squadra")
        self.btn_save_party.clicked.connect(self.save_party_changes)
        save_layout.addWidget(self.btn_save_party)
        layout.addLayout(save_layout)
        self.tabs.addTab(self.party_tab, "Squadra")

    def _init_pc_tab(self):
        self.pc_tab = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(self.pc_tab)
        filter_layout = QtWidgets.QHBoxLayout()
        filter_layout.addWidget(QtWidgets.QLabel("Filtra per Box:"))
        self.pc_box_combo = QtWidgets.QComboBox()
        self.pc_box_combo.addItem("Tutti i Box", -1)

        # Aggiunta Box 1-25
        for i in range(1, 26):
            self.pc_box_combo.addItem(f"Box {i}", i)

        # [MODIFICA V16] Aggiunta Box Preset (26)
        self.pc_box_combo.addItem("Preset Box (26)", 26)

        self.pc_box_combo.currentIndexChanged.connect(self.refresh_pc_table)
        filter_layout.addWidget(self.pc_box_combo)
        filter_layout.addStretch()
        layout.addLayout(filter_layout)

        self.pc_table = QtWidgets.QTableWidget()
        # [MODIFICA 1] Aumentate colonne da 7 a 8 per "Strumento"
        self.pc_table.setColumnCount(8)
        self.pc_table.setHorizontalHeaderLabels(
            ["Icona", "Box", "Slot", "Nickname", "Specie", "Lv", "Natura", "Strumento"])
        self.pc_table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.Stretch)
        self.pc_table.horizontalHeader().setSectionResizeMode(0, QtWidgets.QHeaderView.ResizeToContents)
        self.pc_table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.pc_table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.pc_table.setIconSize(QtCore.QSize(64, 64))
        self.pc_table.setAlternatingRowColors(True)
        self.pc_table.verticalHeader().setVisible(False)
        layout.addWidget(self.pc_table)

        pc_btn_layout = QtWidgets.QHBoxLayout()
        self.btn_pc_edit_nature = QtWidgets.QPushButton("Modifica Natura")
        self.btn_pc_edit_ivs = QtWidgets.QPushButton("Modifica IVs")
        self.btn_pc_edit_evs = QtWidgets.QPushButton("Modifica EVs")
        self.btn_pc_edit_level = QtWidgets.QPushButton("Modifica Exp/Livello")
        # [MODIFICA 2] Nuovo Bottone Strumento
        self.btn_pc_edit_item = QtWidgets.QPushButton("Modifica Strumento")

        self.btn_save_pc = QtWidgets.QPushButton("Salva PC (v15)")
        self.btn_save_pc.setStyleSheet("font-weight: bold; color: #ff9999;")

        self.btn_pc_edit_nature.clicked.connect(lambda: self.edit_nature(is_party=False))
        self.btn_pc_edit_ivs.clicked.connect(lambda: self.edit_ivs(is_party=False))
        self.btn_pc_edit_evs.clicked.connect(lambda: self.edit_evs(is_party=False))
        self.btn_pc_edit_level.clicked.connect(self.edit_pc_level)
        self.btn_pc_edit_item.clicked.connect(self.edit_pc_item)  # Connect new button
        self.btn_save_pc.clicked.connect(self.save_pc_changes)

        pc_btn_layout.addWidget(self.btn_pc_edit_nature)
        pc_btn_layout.addWidget(self.btn_pc_edit_ivs)
        pc_btn_layout.addWidget(self.btn_pc_edit_evs)
        pc_btn_layout.addWidget(self.btn_pc_edit_level)
        pc_btn_layout.addWidget(self.btn_pc_edit_item)  # Add to layout
        pc_btn_layout.addWidget(self.btn_pc_edit_moves)  # <--- Aggiungi qui
        pc_btn_layout.addStretch()
        pc_btn_layout.addWidget(self.btn_save_pc)
        layout.addLayout(pc_btn_layout)
        self.tabs.addTab(self.pc_tab, "PC Box")

    def _init_bag_tab(self):
        self.bag_tab = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(self.bag_tab)
        search_layout = QtWidgets.QHBoxLayout()
        search_layout.addWidget(QtWidgets.QLabel("ID Oggetto:"))
        self.item_id_spin = QtWidgets.QSpinBox()
        self.item_id_spin.setRange(0, 2000)
        self.item_id_spin.setValue(1)
        search_layout.addWidget(self.item_id_spin)
        self.btn_scan_items = QtWidgets.QPushButton("Scansiona Save")
        self.btn_scan_items.clicked.connect(self.scan_items)
        search_layout.addWidget(self.btn_scan_items)
        search_layout.addStretch()
        layout.addLayout(search_layout)

        self.candidates_table = QtWidgets.QTableWidget()
        self.candidates_table.setColumnCount(7)
        self.candidates_table.setHorizontalHeaderLabels(
            ["#", "Settore", "ID Settore", "Offset", "Qty", "Save Index", "Stato"])
        self.candidates_table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.Stretch)
        self.candidates_table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.candidates_table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.candidates_table.setAlternatingRowColors(True)
        self.candidates_table.verticalHeader().setVisible(False)
        layout.addWidget(self.candidates_table, 1)

        self.btn_load_pocket = QtWidgets.QPushButton("Carica Tasca selezionata")
        self.btn_load_pocket.clicked.connect(self.load_pocket)
        layout.addWidget(self.btn_load_pocket)

        self.pocket_table = QtWidgets.QTableWidget()
        self.pocket_table.setColumnCount(5)
        self.pocket_table.setHorizontalHeaderLabels(["#", "Offset", "Qty", "Oggetto", "ID"])
        self.pocket_table.horizontalHeader().setSectionResizeMode(QtWidgets.QHeaderView.Stretch)
        self.pocket_table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.pocket_table.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
        self.pocket_table.setAlternatingRowColors(True)
        self.pocket_table.verticalHeader().setVisible(False)
        layout.addWidget(self.pocket_table, 2)

        pocket_btn_layout = QtWidgets.QHBoxLayout()
        self.btn_modify_slot = QtWidgets.QPushButton("Modifica Slot")
        self.btn_modify_slot.clicked.connect(self.modify_slot)
        self.btn_save_bag = QtWidgets.QPushButton("Salva Tasca")
        self.btn_save_bag.clicked.connect(self.save_bag_changes)
        pocket_btn_layout.addWidget(self.btn_modify_slot)
        pocket_btn_layout.addStretch()
        pocket_btn_layout.addWidget(self.btn_save_bag)
        layout.addLayout(pocket_btn_layout)
        self.tabs.addTab(self.bag_tab, "Borsa")

    # ---------- CARICAMENTO E SALVATAGGIO ----------
    def open_save(self):
        path, _ = QtWidgets.QFileDialog.getOpenFileName(self, "Seleziona file di salvataggio", "",
                                                        "GBA Save (*.sav);;Tutti i file (*)")
        if not path: return
        try:
            with open(path, "rb") as f:
                self.full_data = bytearray(f.read())
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "Errore", f"Impossibile leggere il file:\n{e}")
            return
        self.save_path = path
        self.path_label.setText(os.path.basename(path))
        party_mod.find_and_load_ct()
        bag_mod.load_names_from_ct()
        box_mod.find_and_load_ct()  # Carica nomi anche per il modulo box v15
        self.load_party_data()
        self.load_trainer_data()
        self.load_pc_data()
        self.reset_bag_tab()

    def load_trainer_data(self):
        if not self.full_data: return
        sections = money_mod.list_sections(self.full_data)
        trainer_secs = [s for s in sections if s["id"] == money_mod.TRAINER_SECTION_ID]
        if not trainer_secs: return
        trainer_secs.sort(key=lambda x: x['saveidx'], reverse=True)
        payload = trainer_secs[0]["data"]
        try:
            money = money_mod.ru32(payload, money_mod.FALLBACK_OFF_MONEY)
            if money > 9999999: money = 0
            self.money_spin.setValue(money)
            self.btn_save_money.setEnabled(True)
        except:
            pass

    def save_money_changes(self):
        if not self.save_path: return
        new_val = self.money_spin.value()
        try:
            shutil.copy(self.save_path, self.save_path + ".bak_money")
            self.full_data = bytearray(money_mod.patch_money_everywhere(self.full_data, new_val))
            with open(self.save_path, "wb") as f:
                f.write(self.full_data)
            QtWidgets.QMessageBox.information(self, "Successo", "Soldi aggiornati.")
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "Errore", str(e))

    # ---------- LOGICA SQUADRA ----------
    def load_party_data(self):
        self.party_pokemon_list = []
        self.party_table.setRowCount(0)
        if not self.full_data: return
        # Logica party (invariata)
        section_size = party_mod.SECTION_SIZE
        num_sections = len(self.full_data) // section_size
        trainer_sections = []
        for i in range(num_sections):
            off = i * section_size
            if party_mod.ru16(self.full_data, off + party_mod.FOOTER_ID_OFF) == party_mod.TRAINER_SECTION_ID:
                idx = party_mod.ru32(self.full_data, off + party_mod.FOOTER_SAVEIDX_OFF)
                trainer_sections.append({"off": off, "idx": idx})
        if not trainer_sections: return
        trainer_sections.sort(key=lambda x: x["idx"], reverse=True)
        self.party_trainer_sections = trainer_sections
        self.party_active_sec_off = trainer_sections[0]["off"]
        sec_data = self.full_data[self.party_active_sec_off: self.party_active_sec_off + section_size]

        team_count = party_mod.ru32(sec_data, 0x34)
        if team_count > 6: team_count = 6
        for i in range(team_count):
            mon_off = 0x38 + (i * 100)
            self.party_pokemon_list.append(party_mod.Pokemon(sec_data[mon_off: mon_off + 100]))
        self.refresh_party_table()

    def refresh_party_table(self):
        self.party_table.setRowCount(len(self.party_pokemon_list))
        for row, pk in enumerate(self.party_pokemon_list):
            self._fill_pokemon_row(self.party_table, row, pk, is_pc=False)

    def save_party_changes(self):
        if not self.save_path: return
        try:
            shutil.copy(self.save_path, self.save_path + ".bak_party")
            packed = [p.pack_data() for p in self.party_pokemon_list]
            for sec in self.party_trainer_sections:
                off = sec["off"]
                c_data = bytearray(self.full_data[off: off + party_mod.SECTION_SIZE])
                for i, p_data in enumerate(packed):
                    mo = 0x38 + (i * 100)
                    c_data[mo: mo + 100] = p_data
                chk = party_mod.calculate_section_checksum(c_data)
                party_mod.wu16(c_data, party_mod.FOOTER_CHK_OFF, chk)
                self.full_data[off: off + party_mod.SECTION_SIZE] = c_data
            with open(self.save_path, "wb") as f:
                f.write(self.full_data)
            QtWidgets.QMessageBox.information(self, "OK", "Squadra salvata.")
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "Errore", str(e))

    # ---------- LOGICA PC BOX (V16) ----------
    def load_pc_data(self):
        self.pc_pokemon_list = []
        self.pc_context = {}
        self.pc_table.setRowCount(0)
        if not self.full_data: return
        try:
            # Usa il modulo v16 per la logica dello stream
            sectors = box_mod.get_active_pc_sectors(self.full_data)
            if not sectors: return

            # [MODIFICA V16] rebuild_buffer ora restituisce 4 valori
            pc_buffer, headers, originals, preset_buffer = box_mod.rebuild_buffer(self.full_data, sectors)

            # Salviamo il preset_buffer nel contesto per usarlo nel salvataggio
            self.pc_context = {
                'sectors': sectors,
                'buffer': pc_buffer,
                'headers': headers,
                'originals': originals,
                'preset_buffer': preset_buffer
            }

            MON_SIZE = box_mod.MON_SIZE_PC
            curr = 0

            # 1. Carica Box Normali (1-25) dallo stream principale
            for box in range(1, 26):
                for slot in range(1, 31):
                    if curr + MON_SIZE > len(pc_buffer): break
                    chunk = pc_buffer[curr: curr + MON_SIZE]
                    pk = box_mod.UnboundPCMon(chunk, box, slot)
                    if pk.is_valid:
                        pk.buffer_offset = curr
                        self.pc_pokemon_list.append(pk)
                    curr += MON_SIZE

            # 2. [MODIFICA V16] Carica Preset Box (26) dal buffer dedicato
            if len(preset_buffer) > 0:
                preset_curr = box_mod.OFFSET_PRESET_START
                # Usiamo PRESET_CAPACITY definito nel modulo (30) o fallback
                limit = getattr(box_mod, 'PRESET_CAPACITY', 30)

                for slot in range(1, limit + 1):
                    if preset_curr + MON_SIZE > len(preset_buffer): break
                    raw_data = preset_buffer[preset_curr: preset_curr + MON_SIZE]
                    # Box 26 identifica il Preset
                    pk = box_mod.UnboundPCMon(raw_data, 26, slot)
                    if pk.is_valid:
                        # Nota: questo offset è relativo a preset_buffer, non pc_buffer!
                        pk.buffer_offset = preset_curr
                        self.pc_pokemon_list.append(pk)
                    preset_curr += MON_SIZE

            self.refresh_pc_table()
        except Exception as e:
            print(f"Errore PC: {e}")
            import traceback
            traceback.print_exc()

    def refresh_pc_table(self):
        selected_box = self.pc_box_combo.currentData()
        filtered = [p for p in self.pc_pokemon_list if selected_box == -1 or p.box == selected_box]
        self.pc_table.setRowCount(len(filtered))
        self.pc_table_map = {}
        for row, pk in enumerate(filtered):
            self.pc_table_map[row] = pk
            self._fill_pokemon_row(self.pc_table, row, pk, is_pc=True)

    def _fill_pokemon_row(self, table, row, pk, is_pc):
        if is_pc:
            sid = pk.species_id
            nick = pk.nickname
            nature = pk.get_nature_name()
            lvl = "?"  # PC non ha livello fisso
            box_s = str(pk.box)
            slot_s = str(pk.slot)
            # [MODIFICA 3] Recupero nome strumento
            item_id = pk.get_item_id()
            item_name = box_mod.DB_ITEMS.get(item_id, f"ID {item_id}" if item_id > 0 else "-")
        else:
            sid = pk.get_species_id()
            nick = pk.nickname
            nature = pk.get_nature_name()
            try:
                lvl = pk.raw[0x54]
            except:
                lvl = "?"
            box_s = "Party"
            slot_s = str(row + 1)
            item_name = "-"  # Per ora non gestiamo visualizzazione item party in tabella

        s_name = box_mod.DB_SPECIES.get(sid, f"#{sid}")
        icon_item = QtWidgets.QTableWidgetItem()
        icon_item.setIcon(self.get_pokemon_icon(sid))

        table.setItem(row, 0, icon_item)
        table.setItem(row, 1, QtWidgets.QTableWidgetItem(box_s))
        table.setItem(row, 2, QtWidgets.QTableWidgetItem(slot_s))
        table.setItem(row, 3, QtWidgets.QTableWidgetItem(nick))
        table.setItem(row, 4, QtWidgets.QTableWidgetItem(s_name))
        table.setItem(row, 5, QtWidgets.QTableWidgetItem(str(lvl)))
        table.setItem(row, 6, QtWidgets.QTableWidgetItem(nature))
        table.setItem(row, 7, QtWidgets.QTableWidgetItem(item_name))  # [MODIFICA 4] Set colonna item
        table.setRowHeight(row, 70)

    # Editing PC
    def edit_pc_level(self):
        pk = self._get_selected_pc_mon()
        if not pk: return
        dlg = QtWidgets.QDialog(self)
        dlg.setWindowTitle("Livello & Exp")
        layout = QtWidgets.QVBoxLayout(dlg)

        layout.addWidget(QtWidgets.QLabel("Seleziona Curva di Crescita:"))
        combo = QtWidgets.QComboBox()
        for k, v in GROWTH_NAMES.items(): combo.addItem(f"{k}: {v}", k)
        layout.addWidget(combo)

        lbl_info = QtWidgets.QLabel(f"Exp Attuale: {pk.exp}")
        layout.addWidget(lbl_info)

        layout.addWidget(QtWidgets.QLabel("Nuovo Livello (1-100):"))
        spin = QtWidgets.QSpinBox()
        spin.setRange(1, 100)
        layout.addWidget(spin)

        def update_est():
            est = calc_current_level(combo.currentData(), pk.exp)
            lbl_info.setText(f"Exp: {pk.exp} -> Livello Stimato: {est}")

        combo.currentIndexChanged.connect(update_est)
        update_est()

        btns = QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.Ok | QtWidgets.QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        layout.addWidget(btns)

        if dlg.exec_() == QtWidgets.QDialog.Accepted:
            req_exp = get_exp_at_level(combo.currentData(), spin.value())
            pk.set_exp(req_exp)
            self.refresh_pc_table()
            QtWidgets.QMessageBox.information(self, "Fatto", f"Exp impostata a {req_exp}")

    # [MODIFICA 5] Nuova funzione Modifica Strumento PC
    def edit_pc_item(self):
        pk = self._get_selected_pc_mon()
        if not pk: return

        # Prepara lista items
        items = [f"{k}: {v}" for k, v in sorted(box_mod.DB_ITEMS.items())]
        # Aggiungi opzione rimozione se non c'è
        if 0 not in box_mod.DB_ITEMS:
            items.insert(0, "0: --- Rimuovi ---")

        current_id = pk.get_item_id()
        # Trova indice corrente nella lista (per selezionarlo di default)
        current_idx = 0
        for i, text in enumerate(items):
            if text.startswith(f"{current_id}:"):
                current_idx = i
                break

        item_str, ok = QtWidgets.QInputDialog.getItem(self, "Modifica Strumento",
                                                      f"Attuale: {box_mod.DB_ITEMS.get(current_id, current_id)}\nScegli nuovo oggetto:",
                                                      items, current_idx, False)
        if ok and item_str:
            try:
                new_id = int(item_str.split(":")[0])
                pk.set_item_id(new_id)
                self.refresh_pc_table()
            except:
                pass

    def save_pc_changes(self):
        if not self.save_path: return
        try:
            shutil.copy(self.save_path, self.save_path + ".bak_pc")

            # Recuperiamo i due buffer dal contesto
            std_buffer = self.pc_context['buffer']
            preset_buffer = self.pc_context.get('preset_buffer')  # Potrebbe essere None se non esiste

            # Ciclo su tutti i Pokémon (Box 1-25 + Box 26)
            for pk in self.pc_pokemon_list:
                off = pk.buffer_offset

                if pk.box == 26:
                    # È un Pokémon del Preset: scriviamo nel buffer dedicato
                    if preset_buffer:
                        # Controllo di sicurezza sull'offset
                        if off + box_mod.MON_SIZE_PC <= len(preset_buffer):
                            preset_buffer[off: off + box_mod.MON_SIZE_PC] = pk.raw
                else:
                    # È un Pokémon Standard: scriviamo nel buffer standard
                    if off + box_mod.MON_SIZE_PC <= len(std_buffer):
                        std_buffer[off: off + box_mod.MON_SIZE_PC] = pk.raw

            # CHIAMATA AL BACKEND (V16)
            # Passiamo esplicitamente 'preset_buffer' come ultimo argomento!
            box_mod.write_save_HYBRID(
                self.full_data,
                self.pc_context['sectors'],
                std_buffer,
                self.pc_context['headers'],
                self.pc_context['originals'],
                self.save_path,
                preset_buffer=preset_buffer  # <--- FONDAMENTALE
            )

            # Ricarica i dati freschi
            with open(self.save_path, "rb") as f:
                self.full_data = bytearray(f.read())
            QtWidgets.QMessageBox.information(self, "Successo", "PC e Preset salvati correttamente!")

        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "Errore", str(e))
            import traceback
            traceback.print_exc()

    # [MODIFICA 6] Nuova funzione Modifica Mosse PC
    def edit_pc_moves(self):
        pk = self._get_selected_pc_mon()
        if not pk: return

        # Recupera mosse attuali
        current_moves = pk.get_moves()

        dlg = QtWidgets.QDialog(self)
        dlg.setWindowTitle(f"Modifica Mosse: {pk.nickname}")
        dlg.resize(400, 250)
        layout = QtWidgets.QVBoxLayout(dlg)

        # Prepara la lista delle mosse dal DB caricato in box_mod
        # Ordiniamo alfabeticamente per facilitare la ricerca
        sorted_moves = sorted(box_mod.DB_MOVES.items(), key=lambda x: x[1])
        move_items = ["0: --- Vuoto ---"] + [f"{k}: {v}" for k, v in sorted_moves]

        combos = []

        for i in range(4):
            h_layout = QtWidgets.QHBoxLayout()
            h_layout.addWidget(QtWidgets.QLabel(f"Mossa {i + 1}:"))

            cb = QtWidgets.QComboBox()
            cb.addItems(move_items)

            # Imposta la selezione attuale
            curr_id = current_moves[i]
            # Cerchiamo l'indice nella combo basandoci sull'ID "ID:"
            search_prefix = f"{curr_id}:"
            found_idx = 0

            if curr_id != 0:
                # Ricerca lineare (non ottimizzata ma veloce per 800 item)
                for c_idx in range(cb.count()):
                    if cb.itemText(c_idx).startswith(search_prefix):
                        found_idx = c_idx
                        break

            cb.setCurrentIndex(found_idx)
            combos.append(cb)
            h_layout.addWidget(cb, 1)
            layout.addLayout(h_layout)

        btns = QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.Ok | QtWidgets.QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        layout.addWidget(btns)

        # --- SOSTITUIRE SOLO IL BLOCCO 'if dlg.exec_()...' ---
        if dlg.exec_() == QtWidgets.QDialog.Accepted:
            new_moves = []
            for cb in combos:
                txt = cb.currentText()
                if ":" in txt:
                    try:
                        m_id = int(txt.split(":")[0])
                        new_moves.append(m_id)
                    except:
                        new_moves.append(0)
                else:
                    new_moves.append(0)

            # Applica le modifiche all'oggetto Pokemon
            pk.set_moves(new_moves)

            # [MODIFICA V16] COMMIT CRITICO: Scelta del buffer corretto
            # Se è Box 26 -> usa preset_buffer, altrimenti -> usa pc_buffer

            target_buffer = None

            if pk.box == 26:
                # Caso Preset
                target_buffer = self.pc_context.get('preset_buffer')
                # L'offset in pk.buffer_offset è già relativo a questo buffer
                abs_off = pk.buffer_offset
            else:
                # Caso Standard
                target_buffer = self.pc_context.get('buffer')
                # Calcolo offset assoluto nello stream lineare
                glob_idx = ((pk.box - 1) * 30) + (pk.slot - 1)
                abs_off = glob_idx * box_mod.MON_SIZE_PC

            if target_buffer is not None and abs_off + box_mod.MON_SIZE_PC <= len(target_buffer):
                target_buffer[abs_off: abs_off + box_mod.MON_SIZE_PC] = pk.raw
                QtWidgets.QMessageBox.information(self, "Successo",
                                                  f"Mosse aggiornate nel buffer (Box {pk.box}).\nRicorda di premere 'Salva PC'.")
            else:
                QtWidgets.QMessageBox.critical(self, "Errore",
                                               "Errore di indice nel buffer durante il salvataggio mosse.")

    # Helper Generici
    def _get_selected_pc_mon(self):
        row = self.pc_table.currentRow()
        return self.pc_table_map.get(row)

    def _get_selected_party_mon(self):
        row = self.party_table.currentRow()
        if row < 0: return None
        return self.party_pokemon_list[row]

    def edit_nature(self, is_party):
        pk = self._get_selected_party_mon() if is_party else self._get_selected_pc_mon()
        if not pk: return
        items = [f"{k}: {v}" for k, v in sorted(party_mod.DB_NATURES.items())]
        item, ok = QtWidgets.QInputDialog.getItem(self, "Natura", "Scegli:", items, 0, False)
        if ok:
            pk.set_nature(int(item.split(":")[0]))
            self.refresh_party_table() if is_party else self.refresh_pc_table()

    def edit_ivs(self, is_party):
        pk = self._get_selected_party_mon() if is_party else self._get_selected_pc_mon()
        if not pk: return
        self._stat_editor("IVs", pk.get_ivs(), pk.set_ivs, 31)

    def edit_evs(self, is_party):
        pk = self._get_selected_party_mon() if is_party else self._get_selected_pc_mon()
        if not pk: return
        self._stat_editor("EVs", pk.get_evs(), pk.set_evs, 252)

    def _stat_editor(self, title, data, setter, max_val):
        dlg = QtWidgets.QDialog(self)
        dlg.setWindowTitle(title)
        form = QtWidgets.QFormLayout(dlg)
        spins = {}
        for k in ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe']:
            # Normalizza le chiavi (alcuni usano Spd, altri Spe)
            val = data.get(k, data.get('Spd', 0))
            sb = QtWidgets.QSpinBox()
            sb.setRange(0, max_val)
            sb.setValue(val)
            spins[k] = sb
            form.addRow(k, sb)
        btns = QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.Ok | QtWidgets.QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept)
        btns.rejected.connect(dlg.reject)
        form.addRow(btns)
        if dlg.exec_() == QtWidgets.QDialog.Accepted:
            new_data = {k: sb.value() for k, sb in spins.items()}
            # Retrocompatibilità chiave Velocità
            if 'Spe' in new_data: new_data['Spd'] = new_data['Spe']
            setter(new_data)

    # Placeholder per funzioni party specifiche (Mosse, Item, etc.)
    def edit_moves(self, is_party):
        if not is_party: return
        # Implementazione esistente per Party...
        pass

    def edit_item(self, is_party):
        pass

    def edit_ability(self, is_party):
        pass

    # Logica Borsa (Invariata)
    def reset_bag_tab(self):
        self.bag_candidates = []
        self.bag_anchor_offset = None
        self.candidates_table.setRowCount(0)
        self.pocket_table.setRowCount(0)

    def scan_items(self):
        if not self.full_data: return
        try:
            cands = bag_mod.scan_for_item_candidates(self.full_data, self.item_id_spin.value())
            self.bag_candidates = cands
            self.candidates_table.setRowCount(len(cands))
            max_idx = max((c['save_idx'] for c in cands), default=-1)
            for r, c in enumerate(cands):
                stat = "ATTIVO" if c['save_idx'] == max_idx else "BACKUP"
                row = [str(r + 1), str(c['sector']), str(c['sect_id']), hex(c['offset']), str(c['qty']),
                       str(c['save_idx']), stat]
                for col, val in enumerate(row):
                    self.candidates_table.setItem(r, col, QtWidgets.QTableWidgetItem(val))
        except:
            pass

    def load_pocket(self):
        r = self.candidates_table.currentRow()
        if r < 0: return
        self.bag_anchor_offset = self.bag_candidates[r]['offset']
        items = bag_mod.map_pocket_from_anchor(self.full_data, self.bag_anchor_offset)
        self.bag_pocket_items = items
        self.pocket_table.setRowCount(len(items))
        for r, itm in enumerate(items):
            row = [str(r + 1), hex(itm['offset']), str(itm['qty']), itm['name'], str(itm['id'])]
            for c, val in enumerate(row):
                self.pocket_table.setItem(r, c, QtWidgets.QTableWidgetItem(val))

    def modify_slot(self):
        r = self.pocket_table.currentRow()
        if r < 0: return
        itm = self.bag_pocket_items[r]
        dlg = QtWidgets.QDialog(self)
        form = QtWidgets.QFormLayout(dlg)
        sb_id = QtWidgets.QSpinBox();
        sb_id.setRange(0, 2000);
        sb_id.setValue(itm['id'])
        sb_qty = QtWidgets.QSpinBox();
        sb_qty.setRange(0, 999);
        sb_qty.setValue(itm['qty'])
        form.addRow("ID:", sb_id);
        form.addRow("Qty:", sb_qty)
        btns = QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.Ok | QtWidgets.QDialogButtonBox.Cancel)
        btns.accepted.connect(dlg.accept);
        btns.rejected.connect(dlg.reject)
        form.addRow(btns)
        if dlg.exec_() == QtWidgets.QDialog.Accepted:
            try:
                bag_mod.wu16(self.full_data, itm['offset'], sb_id.value())
                bag_mod.wu16(self.full_data, itm['offset'] + 2, sb_qty.value())
                self.load_pocket()
            except:
                pass

    def save_bag_changes(self):
        if not self.save_path or self.bag_anchor_offset is None: return
        try:
            shutil.copy(self.save_path, self.save_path + ".bak_bag")
            bag_mod.recalculate_checksum(self.full_data, self.bag_anchor_offset)
            with open(self.save_path, "wb") as f:
                f.write(self.full_data)
            QtWidgets.QMessageBox.information(self, "OK", "Borsa Salvata.")
        except Exception as e:
            QtWidgets.QMessageBox.critical(self, "Errore", str(e))


if __name__ == "__main__":
    app = QtWidgets.QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec_())