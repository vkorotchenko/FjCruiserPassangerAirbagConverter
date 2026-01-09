# FjCruiserPassangerAirbagConverter
Converts the output of mustang seats weight sensors to proper output for the FJ so that the seat sensor works 

# Output
The FJ cruiser outputs reads the weight of the passenger using 4 sensors( Occupant classification sensor) at the corners of the seat. We can replicate the input in 2 ways. Option 1 is to replicate the output of the sensors using a potentiometer or resistors. Option 2 is to connect to the k-line (represented as DIA in the diagram below) and replicate the signal coming from both the car and the controller. Option 1 is simpler but requires keeping the origional on board occupancy module. while option 2 requires less pieces but more engineering effort.

![FJ OCS Wiring](res/fj_ocs_wiring.png)

# Input

The input for the controller is CAN bus, the canbus coming from the new seats will let us know 3 things, whether we are buckled up, if the weight is a "child" to disable the seatblet chime and the passanger airbags, or if the weight surpasses the 30Kg limit it will disable the chime but keep the passanger airbag on. This will potentially be expanded to control using a button or K-wire input.

![Mustang seat wiring](res/mustang_seats_wiring.png)

# Supported Communications
### K-line
older cars, including the FJ may have a single line for communication between components (see above diagram 'DIA'), this communication is aligned with ISO 9141-2. In order for communications to be established between and arduino (running at 3.3 or 5V) and the car (12-18V) we must use a logic lever shifter. In this case we are using the MC33290 chip alongside with the [OBD9141](https://github.com/iwanders/OBD9141) library

![MC33290 wiring](res/mc33290_wiring.png)

# Hardware
for this project I am using the following hardware, these can be changed and will work with any arduino board with a MCP2515 chip/ breakout board. to modify the board please fork and mofify the env to match your board, take care to adjust the CS pin used in the CanHandler.h

 - [Adafruit Feather M0 Express](https://www.adafruit.com/product/3403)
- [Adafruit CAN Bus FeatherWing](https://www.adafruit.com/product/5709)
- [MC33290](https://www.aliexpress.com/item/1005008723003659.html)


Wiring diagram: Coming soon


# Warning
I Absolutly do not recommend rewiring your seat, this can lead to injury and death. This project if for educationl purposes only.