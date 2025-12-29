#include <Arduino.h>
#include "CanHandler.h"

// put function declarations here:
int myFunction(int, int);

void setup() {
  // put your setup code here, to run once:
  int result = myFunction(2, 3);
	canHandler.setup();
}

void loop() {

  	canHandler.process();
}

// put function definitions here:
int myFunction(int x, int y) {
  return x + y;
}