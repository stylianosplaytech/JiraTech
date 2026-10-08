import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards';
import { AuthRequest } from '../common/auth-user';
import { SearchService } from './search.service';

class SearchDto {
  @IsOptional()
  @IsString()
  jql?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startAt?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  maxResults?: number;
}

class CreateFilterDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  jql!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

class UpdateFilterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  jql?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get('search')
  searchGet(@Query() q: SearchDto, @Request() req: AuthRequest) {
    return this.searchService.search(q.jql ?? '', req.user, q.startAt, q.maxResults);
  }

  @Post('search')
  searchPost(@Body() body: SearchDto, @Request() req: AuthRequest) {
    return this.searchService.search(body.jql ?? '', req.user, body.startAt, body.maxResults);
  }

  @Post('search/validate')
  validate(@Body() body: SearchDto, @Request() req: AuthRequest) {
    return this.searchService.validate(body.jql ?? '', req.user);
  }

  @Get('search/quick')
  quick(@Request() req: AuthRequest, @Query('q') q = '') {
    return this.searchService.quickSearch(q, req.user);
  }

  @Get('filters')
  listFilters(@Request() req: AuthRequest) {
    return this.searchService.listFilters(req.user);
  }

  @Get('filters/:id')
  getFilter(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.searchService.getFilter(id, req.user);
  }

  @Post('filters')
  createFilter(@Body() dto: CreateFilterDto, @Request() req: AuthRequest) {
    return this.searchService.createFilter(dto, req.user);
  }

  @Patch('filters/:id')
  updateFilter(@Param('id') id: string, @Body() dto: UpdateFilterDto, @Request() req: AuthRequest) {
    return this.searchService.updateFilter(id, dto, req.user);
  }

  @Delete('filters/:id')
  deleteFilter(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.searchService.deleteFilter(id, req.user);
  }
}
