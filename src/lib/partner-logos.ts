import type { ImageMetadata } from 'astro';

import boardGameCompany from '../../sponsor-logos/Board Game Company.png';
import brbSnacks from '../../sponsor-logos/BRB Snacks.png';
import catsFromHell from '../../sponsor-logos/Cats from hell.png';
import diceDeedsArt from '../../sponsor-logos/DiceDeedsArt.PNG';
import forensicFiles from '../../sponsor-logos/Forensic Files.png';
import jigsawNation from '../../sponsor-logos/Jigsaw Nation.png';
import leelaBhoomi from '../../sponsor-logos/Leela Bhoomi.png';
import mozaicGames from '../../sponsor-logos/Mozaic games.png';
import shuffleNRoll from '../../sponsor-logos/Shuffle N Roll.png';
import squircleGames from '../../sponsor-logos/Squircle Games.png';
import theBangaloreLocal from '../../sponsor-logos/The Bangalore Local.png';
import theKyuCo from '../../sponsor-logos/The Kyu Co.png';
import ttrpgCon from '../../sponsor-logos/TTRPGcon.png';
import turnZeroClub from '../../sponsor-logos/Turn Zero Club.png';
import zenwoodGames from '../../sponsor-logos/Zenwood Games.png';

export interface PartnerLogo {
  name: string;
  image: ImageMetadata;
}

export const partnerLogos: PartnerLogo[] = [
  { name: 'Board Game Company', image: boardGameCompany },
  { name: 'BRB Snacks', image: brbSnacks },
  { name: 'Cats from Hell', image: catsFromHell },
  { name: 'DiceDeedsArt', image: diceDeedsArt },
  { name: 'Forensic Files', image: forensicFiles },
  { name: 'Jigsaw Nation', image: jigsawNation },
  { name: 'Leela Bhoomi', image: leelaBhoomi },
  { name: 'Mozaic Games', image: mozaicGames },
  { name: 'Shuffle N Roll', image: shuffleNRoll },
  { name: 'Squircle Games', image: squircleGames },
  { name: 'The Bangalore Local', image: theBangaloreLocal },
  { name: 'The Kyu Co.', image: theKyuCo },
  { name: 'TTRPGCon', image: ttrpgCon },
  { name: 'Turn Zero Club', image: turnZeroClub },
  { name: 'Zenwood Games', image: zenwoodGames },
];
