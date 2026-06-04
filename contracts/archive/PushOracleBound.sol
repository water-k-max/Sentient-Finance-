// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================
//  PUSH ORACLE BOUND ADAPTER
//  Wraps DIA + Protofire into a unified sanity rail.
//  Returns the average of available sources as the bound price.
//  Oracle contract uses this only for deviation checking —
//  never as the primary execution price.
// ============================================================

/// @notice DIA Oracle interface (mainnet: 0xbA0E0750A56e995506CA458b2BdD752754CF39C4)
interface IDIAOracle {
    function getValue(string memory key)
        external
        view
        returns (uint128 price, uint128 timestamp);
}

/// @notice Chainlink/Protofire compatible interface
interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

contract PushOracleBound {

    IDIAOracle  public immutable diaOracle;
    IAggregatorV3 public immutable protofireOracle;

    uint256 public constant STALENESS_THRESHOLD = 60 seconds;

    constructor(address _dia, address _protofire) {
        diaOracle       = IDIAOracle(_dia);
        protofireOracle = IAggregatorV3(_protofire);
    }

    /// @notice Returns the best available bound price (18 decimals)
    /// @dev    Averages non-stale sources. Reverts if ALL sources stale.
    function getBoundPrice(string memory diaKey)
        external
        view
        returns (uint256 boundPrice)
    {
        uint256 sum;
        uint256 count;

        try diaOracle.getValue(diaKey) returns (uint128 price, uint128 ts) {
            if (block.timestamp - ts <= STALENESS_THRESHOLD && price > 0) {
                sum   += uint256(price) * 1e10;
                count += 1;
            }
        } catch {}

        try protofireOracle.latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (
                block.timestamp - updatedAt <= STALENESS_THRESHOLD &&
                answer > 0
            ) {
                sum   += uint256(answer) * 1e10;
                count += 1;
            }
        } catch {}

        require(count > 0, "All push oracles stale");
        boundPrice = sum / count;
    }

    /// @notice Check whether a price is within the allowed band of the bound
    /// @param  candidate  Price to validate (18 decimals)
    /// @param  bound      Bound price from getBoundPrice (18 decimals)
    /// @param  bpsTolerance  Allowed deviation in basis points (e.g. 200 = 2%)
    function withinBand(
        uint256 candidate,
        uint256 bound,
        uint256 bpsTolerance
    ) external pure returns (bool) {
        uint256 delta = candidate > bound
            ? candidate - bound
            : bound - candidate;
        return delta * 10_000 <= bound * bpsTolerance;
    }
}
