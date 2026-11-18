// Friends: a list kept by each character. A request must be accepted; then each sees whether the
// other is online, and where.
export const FRIENDS_MAX = 100;
/** `friend`: accepted. `in`: they asked you. `out`: you asked them. */
export type FriendState = 'friend' | 'in' | 'out';
export interface FriendView {
  id: number;
  name: string;
  job: string;
  level: number;
  state: FriendState;
  online: boolean;
  /** Where an online friend is (the region's or dungeon's name); '' when offline or not yet a friend. */
  zone: string;
  /** In a party already (an invitation would be refused). */
  party: boolean;
}
