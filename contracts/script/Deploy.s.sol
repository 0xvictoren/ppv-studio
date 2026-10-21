// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../PayPerWatch.sol";

contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint16 feeBps_ = uint16(vm.envUint("FEE_BPS"));
        address feeRecipient_ = vm.envAddress("FEE_RECIPIENT");
        address initialOwner = vm.envAddress("INITIAL_OWNER");

        vm.startBroadcast();
        new PayPerWatch(usdc, feeBps_, feeRecipient_, initialOwner);
        vm.stopBroadcast();
    }
}
