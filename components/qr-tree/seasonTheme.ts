// ---------------------------------------------------------------------------
// seasonTheme.ts — Season configurations matching tree.icqr.com
// ---------------------------------------------------------------------------

export type Season = "spring" | "summer" | "autumn";

export interface SeasonTheme {
  name: string;
  label: string;
  iconName: string;
  // QR pixel colors
  qrDarkPalette: string[];
  qrLightPalette: string[];
  cornerAccent: string[];
  // 3D Tree colors
  foliageColors: string[];
  trunkColor: string;
  grassColors: string[];
  stoneTileColors: string[];
  // Atmosphere & particles
  particleColor: string;
  particleType: "petals" | "rain" | "leaves";
  rainMode: boolean;
  sunColor: string;
  ambientColor: string;
  bgColor: string;
}

export const SEASON_THEMES: Record<Season, SeasonTheme> = {
  spring: {
    name: "spring",
    label: "Spring",
    iconName: "spring",
    qrDarkPalette: ["#4a8a3a", "#5a9a44", "#6bb542", "#7bc44f", "#e899b8", "#f3b8cc"],
    qrLightPalette: ["#f2ece0", "#eae2d2", "#e2d9c4"],
    cornerAccent: ["#8a7a58", "#9a8862"],
    foliageColors: ["#f3b8cc", "#ffc8d9", "#8fd35f", "#9fe072", "#b7ea94", "#f7adc5", "#70c842"],
    trunkColor: "#6b4a30",
    grassColors: ["#68bd37", "#7ece48", "#54a828"],
    stoneTileColors: ["#ede7d8", "#e4ddcc", "#dad3bf", "#e8e1cf"],
    particleColor: "#f3b8cc",
    particleType: "petals",
    rainMode: false,
    sunColor: "#fff8e8",
    ambientColor: "#fff4e4",
    bgColor: "#f7f4ed",
  },
  summer: {
    name: "summer",
    label: "Summer",
    iconName: "summer",
    qrDarkPalette: ["#2d6a2e", "#3a7a30", "#488c38", "#569e40", "#33722a", "#62aa48"],
    qrLightPalette: ["#ede7d8", "#e4ddcc", "#dad2be", "#f2ece0"],
    cornerAccent: ["#827252", "#92805c"],
    foliageColors: ["#68cb35", "#7bd844", "#5ab92a", "#4ea822", "#8ee452", "#42981b", "#72d23e"],
    trunkColor: "#5c3f28",
    grassColors: ["#5ab826", "#6dc935", "#489e1b", "#78d43e"],
    stoneTileColors: ["#ede7d8", "#e4ddcc", "#dad3bf", "#ded7c5"],
    particleColor: "#8ee452",
    particleType: "leaves",
    rainMode: false,
    sunColor: "#fffbe8",
    ambientColor: "#fff7e6",
    bgColor: "#f7f4ed",
  },
  autumn: {
    name: "autumn",
    label: "Autumn",
    iconName: "autumn",
    qrDarkPalette: ["#b8621f", "#c97425", "#d9862c", "#a0541a", "#d47a28", "#8e4815"],
    qrLightPalette: ["#eee4d2", "#e5dac4", "#dcceb4"],
    cornerAccent: ["#7a5a3a", "#8a6642"],
    foliageColors: ["#d97b29", "#e0a83c", "#c1531f", "#e6c34a", "#b8621f", "#d4952e", "#e8b038"],
    trunkColor: "#5a3a22",
    grassColors: ["#a88c38", "#b89a42", "#92782e"],
    stoneTileColors: ["#ebe1cd", "#e0d5be", "#d5c8af"],
    particleColor: "#8aacbc",
    particleType: "rain",
    rainMode: true,
    sunColor: "#faebd7",
    ambientColor: "#eee0cc",
    bgColor: "#f5f0e6",
  },
};
