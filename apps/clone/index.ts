interface Level {
  name: string;
  grid: GridCell[][];
}

type GridCellStack = GridCell[];

type GridCell = Tile | Character | Monsters | Item;

type Character = Chip;
type Monsters = Monster | Item;
type Tile = Water | Wall | Door | Block;
type Item = Key;

// Characters
interface CharacterBase {
  baseType: 'character';
}

interface Chip extends CharacterBase {
  type: 'chip';
  health: number;
  inventory: Item[];
}

// Monsters
interface MonsterBase {
  baseType: 'monster';
}

interface Monster extends MonsterBase {
  type: 'monster';
}

interface Bee extends MonsterBase {
  type: 'bee';
}

// Tiles
interface TileBase {
  baseType: 'tile';
}

interface Wall extends TileBase {
  type: 'wall'
}

interface Water extends TileBase {
  type: 'water'
}

interface Block extends TileBase {
  type: 'block';
}

interface Door extends TileBase {
  type: 'door';
  keyType: KeyColor;
}

// Items
interface ItemBase {
  baseType: 'item';
}

type KeyColor = 'red' | 'green' | 'blue' | 'yellow';
interface Key extends ItemBase {
  type: 'key';
  keyType: KeyColor;
}


type CellBaseType = GridCell['baseType'];
type CellType = GridCell['type'];