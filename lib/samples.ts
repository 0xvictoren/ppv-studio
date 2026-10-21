import { keccak256, toHex, type Hex } from "viem";

// Creative Commons sample content (Blender Foundation open movies, CC BY 3.0), served from the
// Internet Archive. Posters from Wikimedia Commons.
export const SAMPLE_VIDEOS = [
  {
    cid: "sample-big-buck-bunny",
    title: "Big Buck Bunny",
    description: "A giant rabbit takes on three bullying rodents. Blender Foundation, CC BY 3.0.",
    playbackUrl: "https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4",
    thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/960px-Big_buck_bunny_poster_big.jpg",
    durationSeconds: 596,
    category: "movies",
    pricePerHour: 500_000n, // $0.50/hr
  },
  {
    cid: "sample-sintel",
    title: "Sintel",
    description: "A lonely girl searches for her dragon companion. Blender Foundation, CC BY 3.0.",
    playbackUrl: "https://archive.org/download/Sintel/sintel-2048-surround.mp4",
    thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/Sintel_poster.jpg/960px-Sintel_poster.jpg",
    durationSeconds: 888,
    category: "movies",
    pricePerHour: 1_000_000n, // $1/hr
  },
  {
    cid: "sample-tears-of-steel",
    title: "Tears of Steel",
    description: "Warriors and scientists try to save the world in Amsterdam. Blender Foundation, CC BY 3.0.",
    playbackUrl: "https://archive.org/download/Tears-of-Steel/tears_of_steel_720p.mp4",
    thumbnailUrl: "https://archive.org/services/img/Tears-of-Steel",
    durationSeconds: 734,
    category: "movies",
    pricePerHour: 2_000_000n, // $2/hr
  },
] as const;

// Mock-mode demo wallets. These keys are public and only ever used against the in-memory mock.
const demoKey = (label: string): Hex => keccak256(toHex(`ppw-demo:${label}`));
export const DEMO_ACCOUNTS = [
  { label: "Viewer Ada", privateKey: demoKey("viewer-ada") },
  { label: "Viewer Ben", privateKey: demoKey("viewer-ben") },
  { label: "Creator Cleo", privateKey: demoKey("creator-cleo") },
] as const;
export const DEMO_CREATOR_KEY = DEMO_ACCOUNTS[2].privateKey;
