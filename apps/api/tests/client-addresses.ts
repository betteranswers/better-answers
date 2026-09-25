const BLOCK = "198.51.100";

const LAST_HOST = 254;

/**
 * Each call of the returned function issues the next host in the block.
 * @throws on the 255th call.
 */
export const defaultClientAddresses = (): (() => string) => {
  let issued = 0;
  return () => {
    issued += 1;
    if (issued > LAST_HOST) {
      throw new Error(
        `a TestApp asked for ${issued} default client addresses and ${BLOCK}.0/24 holds ${LAST_HOST}; split the suite, or have the test that wants more clients than that name its own address in 203.0.113.0/24`,
      );
    }
    return `${BLOCK}.${issued}`;
  };
};
