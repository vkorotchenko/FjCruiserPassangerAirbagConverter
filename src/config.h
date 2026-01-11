#ifndef CONFIG_H_
#define CONFIG_H_


#define SERIAL_SPEED 115200

#define CAN_SPEED                              16
#define CLOCK_SPEED                            MCP_8MHz
#define SPI_CS_PIN                             5

#define OCS_CAN_ID_1 0x265
#define OCS_CAN_ID_2 0x453


// K-line Configuration
#define KLINE_RX_PIN 10
#define KLINE_TX_PIN 11
#define KLINE_INIT_RETRIES 3
#define KLINE_INIT_DELAY 2000
#define KLINE_TIMEOUT 5000

// Digital Potentiometer Configuration (X9C10X) - 4 sensors for seat corners
#define DPOT_MAX_OHM 10000  // X9C103 = 10kΩ (can be 1k, 10k, 50k, or 100k)

// Potentiometer 1 (Front Left)
#define DPOT1_CS_PIN 6       // Chip Select
#define DPOT1_INC_PIN 9      // Increment (Pulse)
#define DPOT1_UD_PIN 5       // Up/Down (Direction)

// Potentiometer 2 (Front Right)
#define DPOT2_CS_PIN A0      // Chip Select
#define DPOT2_INC_PIN A1     // Increment (Pulse)
#define DPOT2_UD_PIN A2      // Up/Down (Direction)

// Potentiometer 3 (Rear Left)
#define DPOT3_CS_PIN A3      // Chip Select
#define DPOT3_INC_PIN A4     // Increment (Pulse)
#define DPOT3_UD_PIN A5      // Up/Down (Direction)

// Potentiometer 4 (Rear Right)
#define DPOT4_CS_PIN 12      // Chip Select
#define DPOT4_INC_PIN 15     // Increment (Pulse)
#define DPOT4_UD_PIN 16      // Up/Down (Direction)

// Potentiometer positions for occupant states (0-99 range)
// Formula: Resistance = (DPOT_MAX_OHM * Position) / 99
#define DPOT_POSITION_OFF 0     // 0Ω - Empty seat, airbag off
#define DPOT_POSITION_CHILD 50  // ~50% resistance - Child weight
#define DPOT_POSITION_ADULT 99  // Maximum resistance - Adult weight

#endif /* CONFIG_H_ */


