export const CONTENT_NFT_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function contentInfo(uint256 tokenId) view returns (address creator, bytes32 contentHash, uint8 contentType, string title, uint256 contentPrice, uint256 accessPrice, uint256 maxPasses, bool exists)',
] as const;

export const ACCESS_TOKEN_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function canAccess(address account, uint256 id) view returns (bool)',
] as const;
