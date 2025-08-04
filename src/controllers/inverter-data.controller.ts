import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  OnModuleInit,
} from '@nestjs/common';
import { InverterDataService } from '../services/inverter-data.service';
import { MqttService } from '../services/mqtt.service';
import { CreateInverterDataDto } from '../dto/create-inverter-data.dto';
import { UpdateInverterDataDto } from '../dto/update-inverter-data.dto';
import { QueryInverterDataDto } from '../dto/query-inverter-data.dto';

@Controller('api/inverter')
export class InverterDataController implements OnModuleInit {
  constructor(
    private readonly inverterDataService: InverterDataService,
    private readonly mqttService: MqttService,
  ) {}

  onModuleInit() {
    // Set up MQTT listeners after module initialization
    setTimeout(() => {
      this.setupMqttListeners();
    }, 1000);
  }

  private setupMqttListeners() {
    if (!this.mqttService) {
      console.error('MqttService is not available');
      return;
    }

    try {
      // Listen to inverter data messages
      this.mqttService.subscribe('inverter/+/data', (topic, message) => {
        console.log(`Received data from ${topic}:`, message);
        // Process the received data
        this.handleInverterDataMessage(topic, message);
      });

      // Listen to inverter commands
      this.mqttService.subscribe('inverter/+/command', (topic, message) => {
        console.log(`Received command from ${topic}:`, message);
        // Process the received command
        this.handleInverterCommandMessage(topic, message);
      });

      // Listen to raw messages without decryption
      this.mqttService.subscribeRaw(
        'inverter/+/status',
        (topic, rawMessage, decryptedMessage) => {
          console.log(`Raw status from ${topic}: ${rawMessage}`);
          if (decryptedMessage) {
            console.log(`Decrypted: ${decryptedMessage}`);
          }
        },
      );

      console.log('MQTT listeners set up successfully');
    } catch (error) {
      console.error('Error setting up MQTT listeners:', error);
    }
  }

  private handleInverterDataMessage(
    topic: string,
    message: Record<string, unknown>,
  ) {
    // Extract device ID from topic (e.g., "inverter/device123/data")
    const deviceId = topic.split('/')[1];

    // Process the message and save to database if needed
    console.log(`Processing data for device ${deviceId}:`, message);
  }

  private handleInverterCommandMessage(
    topic: string,
    message: Record<string, unknown>,
  ) {
    // Extract device ID from topic
    const deviceId = topic.split('/')[1];

    // Process the command
    console.log(`Processing command for device ${deviceId}:`, message);
  }

  @Post('data')
  create(@Body() createInverterDataDto: CreateInverterDataDto) {
    return this.inverterDataService.create(createInverterDataDto);
  }

  @Get('data')
  findAll() {
    return this.inverterDataService.findAll();
  }

  @Get('data/:userId/:deviceId/latest')
  findLatestByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.inverterDataService.findLatestByUserIdAndDeviceId(
      userId,
      deviceId,
    );
  }

  @Get('data/:userId/:deviceId')
  findByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Query() query: QueryInverterDataDto,
  ) {
    return this.inverterDataService.findByUserIdAndDeviceId(
      userId,
      deviceId,
      query.page,
      query.limit,
    );
  }

  @Get('data/:id')
  findOne(@Param('id') id: string) {
    return this.inverterDataService.findOne(id);
  }

  @Patch('data/:id')
  update(
    @Param('id') id: string,
    @Body() updateInverterDataDto: UpdateInverterDataDto,
  ) {
    return this.inverterDataService.update(id, updateInverterDataDto);
  }

  @Patch('data/:userId/:deviceId')
  upsertByUserIdAndDeviceId(
    @Param('userId') userId: string,
    @Param('deviceId') deviceId: string,
    @Body() updateInverterDataDto: UpdateInverterDataDto,
  ) {
    return this.inverterDataService.upsertByUserIdAndDeviceId(
      userId,
      deviceId,
      updateInverterDataDto,
    );
  }

  @Delete('data/:id')
  remove(@Param('id') id: string) {
    return this.inverterDataService.remove(id);
  }

  @Delete('data')
  deleteAll() {
    return this.inverterDataService.deleteAll();
  }
}
