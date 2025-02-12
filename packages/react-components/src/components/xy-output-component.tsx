/* eslint-disable @typescript-eslint/no-explicit-any */
import { AbstractOutputProps, AbstractOutputState } from './abstract-output-component';
import { AbstractTreeOutputComponent } from './abstract-tree-output-component';
import * as React from 'react';
import { Line } from 'react-chartjs-2';
import { QueryHelper } from 'tsp-typescript-client/lib/models/query/query-helper';
import { Entry } from 'tsp-typescript-client/lib/models/entry';
import { ResponseStatus } from 'tsp-typescript-client/lib/models/response/responses';
import { XYSeries } from 'tsp-typescript-client/lib/models/xy';
import Chart = require('chart.js');
import { EntryTree } from './utils/filtrer-tree/entry-tree';
import { getAllExpandedNodeIds } from './utils/filtrer-tree/utils';
import { TreeNode } from './utils/filtrer-tree/tree-node';
import ColumnHeader from './utils/filtrer-tree/column-header';
import { BIMath } from 'timeline-chart/lib/bigint-utils';

type XYOuputState = AbstractOutputState & {
    selectedSeriesId: number[];
    xyTree: Entry[];
    checkedSeries: number[];
    collapsedNodes: number[];
    orderedNodes: number[];
    // FIXME Type this properly
    xyData: any;
    columns: ColumnHeader[];
};
const RIGHT_CLICK_NUMBER = 2;
const ZOOM_IN = true;
const ZOOM_OUT = false;
const PAN_LEFT = true;
const PAN_RIGHT = false;

export class XYOutputComponent extends AbstractTreeOutputComponent<AbstractOutputProps, XYOuputState> {
    private currentColorIndex = 0;
    private colorMap: Map<string, number> = new Map();
    private lineChartRef: any;
    private chartRef: any;
    private mouseIsDown = false;
    private positionXMove = 0;
    private isRightClick = false;
    private posPixelSelect = 0;
    private isMouseLeave = false;
    private startPositionMouseRightClick = BigInt(0);
    private plugin = {
        afterDraw: (chartInstance: Chart, _easing: Chart.Easing, _options?: any) => { this.afterChartDraw(chartInstance); }
    };

    private endSelection = () => {
        if (this.isRightClick) {
           this.applySelectionZoom();
        }
        this.mouseIsDown = false;
        document.removeEventListener('mouseup', this.endSelection);
    };

    private preventDefaultHandler: ((event: WheelEvent) => void) | undefined;

    constructor(props: AbstractOutputProps) {
        super(props);
        this.state = {
            outputStatus: ResponseStatus.RUNNING,
            selectedSeriesId: [],
            xyTree: [],
            checkedSeries: [],
            collapsedNodes: [],
            orderedNodes: [],
            xyData: {},
            columns: [{title: 'Name', sortable: true}],
        };

        this.afterChartDraw = this.afterChartDraw.bind(this);
        this.lineChartRef = React.createRef();
        this.chartRef = React.createRef();
    }

    componentDidMount(): void {
        this.waitAnalysisCompletion();
    }

    async fetchTree(): Promise<ResponseStatus> {
        const parameters = QueryHelper.timeQuery([this.props.range.getStart(), this.props.range.getEnd()]);
        const tspClientResponse = await this.props.tspClient.fetchXYTree(this.props.traceId, this.props.outputDescriptor.id, parameters);
        const treeResponse = tspClientResponse.getModel();
        if (tspClientResponse.isOk() && treeResponse) {
            if (treeResponse.model) {
                const headers = treeResponse.model.headers;
                const columns = [];
                if (headers && headers.length > 0) {
                    headers.forEach(header => {
                        columns.push({title: header.name, sortable: true, tooltip: header.tooltip});
                    });
                } else {
                    columns.push({title: 'Name', sortable: true});
                }
                columns.push({title: 'Legend', sortable: false});
                this.setState({
                    outputStatus: treeResponse.status,
                    xyTree: treeResponse.model.entries,
                    columns
                });
            } else {
                this.setState({
                    outputStatus: treeResponse.status
                });
            }
            return treeResponse.status;
        }
        return ResponseStatus.FAILED;
    }

    componentDidUpdate(prevProps: AbstractOutputProps, prevState: XYOuputState): void {
        const viewRangeChanged = this.props.viewRange !== prevProps.viewRange;
        const checkedSeriesChanged = this.state.checkedSeries !== prevState.checkedSeries;
        const collapsedNodesChanged = this.state.collapsedNodes !== prevState.collapsedNodes;
        const chartWidthChanged = this.props.style.chartWidth !== prevProps.style.chartWidth;
        const needToUpdate = viewRangeChanged || checkedSeriesChanged || collapsedNodesChanged || chartWidthChanged;
        if (needToUpdate || prevState.outputStatus === ResponseStatus.RUNNING) {
            this.updateXY();
        }
        if (this.lineChartRef.current) {
            if (this.preventDefaultHandler === undefined) {
                this.preventDefaultHandler = (event: WheelEvent) => {
                    if (event.ctrlKey) {
                        event.preventDefault();
                    }
                };
                this.chartRef.current.addEventListener('wheel', this.preventDefaultHandler);
            }
            this.lineChartRef.current.chartInstance.render();
        }
    }

    synchronizeTreeScroll(): void { /* Nothing to do by default */ }

    renderTree(): React.ReactNode | undefined {
        this.onToggleCheck = this.onToggleCheck.bind(this);
        this.onToggleCollapse = this.onToggleCollapse.bind(this);
        this.onOrderChange = this.onOrderChange.bind(this);
        return this.state.xyTree.length
            ? <EntryTree
                entries={this.state.xyTree}
                showCheckboxes={true}
                collapsedNodes={this.state.collapsedNodes}
                checkedSeries={this.state.checkedSeries}
                onToggleCheck={this.onToggleCheck}
                onToggleCollapse={this.onToggleCollapse}
                onOrderChange={this.onOrderChange}
                headers={this.state.columns}
            />
            : undefined
            ;
    }

    renderChart(): React.ReactNode {
        const lineOptions: Chart.ChartOptions = {
            responsive: true,
            elements: {
                point: { radius: 0 },
                line: { tension: 0 }
            },
            maintainAspectRatio: false,
            legend: { display: false },
            layout: {
                padding: {
                    left: 0,
                    right: 0,
                    top: 15,
                    bottom: 5
                }
            },
            scales: {
                xAxes: [{ id: 'time-axis', display: false }],
                yAxes: [{ display: false }]
            },
            animation: { duration: 0 },
            events: [ 'mousedown' ],
        };
        // width={this.props.style.chartWidth}
        if (this.state.outputStatus === ResponseStatus.COMPLETED && this.state.xyTree.length === 0 ) {
            return <React.Fragment>
                {
                    <p className='no-data' style={{fontSize: 20, marginRight: '5px', marginLeft: '5px', justifyContent:'center', alignItems:'center'}}>
                        Trace analysis completed.
                        No results: Trace missing required events.
                    </p>
                }
            </React.Fragment>;
        }

        return <React.Fragment>
            {this.state.outputStatus === ResponseStatus.COMPLETED ?
                <div id='xy-main' tabIndex={0}
                    onKeyDown={event => this.onKeyDown(event)}
                    onWheel={event => this.onWheel(event)}
                    onMouseMove={event => this.onMouseMove(event)}
                    onContextMenu={event => event.preventDefault()}
                    onMouseLeave={event => this.onMouseLeave(event)}
                    onMouseDown={event => this.onMouseDown(event)}
                    style={{ height: this.props.style.height }}
                    ref={this.chartRef}
                    >
                    <Line
                        data={this.state.xyData}
                        height={parseInt(this.props.style.height.toString())}
                        options={lineOptions}
                        ref={this.lineChartRef}
                        plugins={[this.plugin]}>
                    </Line>
                </div> :
                <div className='analysis-running'>
                {(
                        <i
                            className='fa fa-refresh fa-spin'
                            style={{ marginRight: '5px' }}
                        />
                    )}
                    {
                    'Analysis running'
                    }
                </div>}
        </React.Fragment>;
    }

    private afterChartDraw(chart: Chart) {
        const ctx = chart.ctx;
        if (ctx) {
            if (this.props.selectionRange) {
                const startPixel = this.getXForTime(this.props.selectionRange.getStart());
                const endPixel = this.getXForTime(this.props.selectionRange.getEnd());
                ctx.strokeStyle = '#259fd8';
                ctx.fillStyle = '#259fd8';
                this.drawSelection(chart, startPixel, endPixel);
            }
            if (this.isRightClick) {
                const offset = this.props.viewRange.getOffset() ?? BigInt(0);
                const startPixel = this.getXForTime(this.startPositionMouseRightClick + offset);
                const endPixel = this.positionXMove;
                ctx.strokeStyle = '#9f9f9f';
                ctx.fillStyle = '#9f9f9f';
                this.drawSelection(chart, startPixel, endPixel);
            }
        }
    }

    private drawSelection(chart: Chart, startPixel: number, endPixel: number) {
        const ctx = chart.ctx;
        const minPixel = Math.min(startPixel, endPixel);
        const maxPixel = Math.max(startPixel, endPixel);
        if (ctx) {
            ctx.save();

            ctx.lineWidth = 1;
            // Selection borders
            if (startPixel > chart.chartArea.left) {
                ctx.beginPath();
                ctx.moveTo(minPixel, 0);
                ctx.lineTo(minPixel, chart.chartArea.bottom);
                ctx.stroke();
            }
            if (endPixel < this.props.viewRange.getEnd()) {
                ctx.beginPath();
                ctx.moveTo(maxPixel, 0);
                ctx.lineTo(maxPixel, chart.chartArea.bottom);
                ctx.stroke();
            }
            // Selection fill
            ctx.globalAlpha = 0.2;
            ctx.fillRect(minPixel, 0, maxPixel - minPixel, chart.chartArea.bottom);
            ctx.restore();
        }
    }

    private onToggleCheck(ids: number[]) {
        let newList = [...this.state.checkedSeries];
        ids.forEach(id => {
            const exist = this.state.checkedSeries.find(seriesId => seriesId === id);

            if (exist !== undefined) {
                newList = newList.filter(series => id !== series);
            } else {
                newList = newList.concat(id);
            }
        });
        this.setState({checkedSeries: newList});
    }

    private onToggleCollapse(id: number, nodes: TreeNode[]) {
        let newList = [...this.state.collapsedNodes];

        const exist = this.state.collapsedNodes.find(expandId => expandId === id);

        if (exist !== undefined) {
            newList = newList.filter(collapsed => id !== collapsed);
        } else {
            newList = newList.concat(id);
        }
        const orderedIds = getAllExpandedNodeIds(nodes, newList);
        this.setState({collapsedNodes: newList, orderedNodes: orderedIds});
    }

    private onOrderChange(ids: number[]) {
        this.setState({orderedNodes: ids});
    }

    private onMouseDown(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        this.isMouseLeave = false;
        this.mouseIsDown = true;
        this.posPixelSelect = event.nativeEvent.screenX;
        const startTime = this.getTimeForX(event.nativeEvent.offsetX);
        if (event.button === RIGHT_CLICK_NUMBER) {
            this.isRightClick = true;
            this.startPositionMouseRightClick = startTime;
        } else {
            this.isRightClick = false;
            if (event.shiftKey && this.props.unitController.selectionRange) {
                this.props.unitController.selectionRange = {
                    start: this.props.unitController.selectionRange.start,
                    end: startTime
                };
            } else {
                this.props.unitController.selectionRange = {
                    start: startTime,
                    end: startTime
                };
            }
            this.onMouseMove(event);
        }
        document.addEventListener('mouseup', this.endSelection);
    }

    private updateRange(rangeStart: bigint, rangeEnd: bigint) {
        if (rangeEnd < rangeStart) {
            const temp = rangeStart;
            rangeStart = rangeEnd;
            rangeEnd = temp;
        }
        this.props.unitController.viewRange = {
            start: rangeStart,
            end: rangeEnd
        };
    }

    private zoom(isZoomIn: boolean) {
        if (this.props.unitController.viewRangeLength >= 1) {
            const position = this.getTimeForX(this.positionXMove);
            const startDistance = position - this.props.unitController.viewRange.start;
            const zoomFactor = isZoomIn ? 0.8 : 1.25;
            const newDuration = BIMath.clamp(Number(this.props.unitController.viewRangeLength) * zoomFactor,
                BigInt(2), this.props.unitController.absoluteRange);
            const newStartRange = BIMath.max(0, position - BIMath.round(Number(startDistance) * zoomFactor));
            const newEndRange = newStartRange + newDuration;
            this.updateRange(newStartRange, newEndRange);
        }
    }

    private pan(panLeft: boolean) {
        const panFactor = 0.1;
        const percentRange = BIMath.round(Number(this.props.unitController.viewRangeLength) * panFactor);
        const panNumber = panLeft ? BigInt(-1) : BigInt(1);
        const startRange = this.props.unitController.viewRange.start + (panNumber * percentRange);
        const endRange = this.props.unitController.viewRange.end + (panNumber * percentRange);
        if (startRange < 0) {
            this.props.unitController.viewRange = {
                start: BigInt(0),
                end: this.props.unitController.viewRangeLength
            };
        } else if (endRange > this.props.unitController.absoluteRange) {
            this.props.unitController.viewRange = {
                start: this.props.unitController.absoluteRange - this.props.unitController.viewRangeLength,
                end: this.props.unitController.absoluteRange
            };
        } else {
            this.props.unitController.viewRange = {
                start: startRange,
                end: endRange
            };
        }
    }

    private onWheel(wheel: React.WheelEvent) {
        this.isMouseLeave = false;
        if (wheel.shiftKey) {
            if (wheel.deltaY < 0) {
                this.pan(PAN_LEFT);
            }
            else if (wheel.deltaY > 0) {
                this.pan(PAN_RIGHT);
            }
        } else if (wheel.ctrlKey) {
            if (wheel.deltaY < 0) {
                this.zoom(ZOOM_IN);
            } else if (wheel.deltaY > 0) {
                this.zoom(ZOOM_OUT);
            }
        }
    }

    private getTimeForX(x: number): bigint {
        if (!this.lineChartRef.current?.chartInstance) {
            return BigInt(0);
        }
        const offset = this.props.viewRange.getOffset() ?? BigInt(0);
        const duration = this.props.viewRange.getDuration();
        const time = this.props.viewRange.getStart() - offset +
            BIMath.round(x / this.lineChartRef.current.chartInstance.width * Number(duration));
        return time;
    }

    protected getXForTime(time: bigint): number {
        if (!this.lineChartRef.current?.chartInstance) {
            return 0;
        }
        const start = this.props.viewRange.getStart();
        const duration = this.props.viewRange.getDuration();
        const x = Number(time - start) / Number(duration) * this.lineChartRef.current.chartInstance.width;
        return x;
    }

    private updateSelection(): void {
        if (this.props.unitController.selectionRange){
            const xStartPos = this.props.unitController.selectionRange.start;
            this.props.unitController.selectionRange = {
                start: xStartPos,
                end: this.getTimeForX(this.positionXMove)
            };
        }
    }

    private onMouseMove(event: React.MouseEvent) {
        this.positionXMove = event.nativeEvent.offsetX;
        this.isMouseLeave = false;
        if (this.mouseIsDown && !this.isRightClick) {
            this.updateSelection();
        }
        if (this.mouseIsDown && this.isRightClick) {
            this.forceUpdate();
        }
    }

    private onMouseLeave(event: React.MouseEvent) {
        this.isMouseLeave = true;
        this.positionXMove = Math.max(0, Math.min(event.nativeEvent.offsetX, this.lineChartRef.current.chartInstance.width));
        this.forceUpdate();
        if (this.mouseIsDown && !this.isRightClick) {
            this.updateSelection();
        }
    }

    private applySelectionZoom() {
        const newStartRange = this.startPositionMouseRightClick;
        const newEndRange = this.getTimeForX(this.positionXMove);
        this.updateRange(newStartRange, newEndRange);
        this.isRightClick = false;
    }

    private onKeyDown(key: React.KeyboardEvent) {
        if (!this.isMouseLeave) {
            switch (key.key) {
                case 'W':
                case 'w':
                case 'i':
                case 'I': {
                    this.zoom(ZOOM_IN);
                    break;
                }
                case 'S':
                case 's':
                case 'K':
                case 'k': {
                    this.zoom(ZOOM_OUT);
                    break;
                }
                case 'A':
                case 'a':
                case 'J':
                case 'j':
                case 'ArrowLeft': {
                    this.pan(PAN_LEFT);
                    break;
                }
                case 'D':
                case 'd':
                case 'L':
                case 'l':
                case 'ArrowRight': {
                    this.pan(PAN_RIGHT);
                    break;
                }
            }
        }
    }

    private async updateXY() {
        let start = BigInt(0);
        let end = BigInt(0);
        const viewRange = this.props.viewRange;
        if (viewRange) {
            start = viewRange.getStart();
            end = viewRange.getEnd();
        }

        const xyDataParameters = QueryHelper.selectionTimeQuery(
            QueryHelper.splitRangeIntoEqualParts(start, end, this.props.style.chartWidth), this.state.checkedSeries);

        const tspClientResponse = await this.props.tspClient.fetchXY(this.props.traceId, this.props.outputDescriptor.id, xyDataParameters);
        const xyDataResponse = tspClientResponse.getModel();
        if (tspClientResponse.isOk() && xyDataResponse) {
            this.buildXYData(xyDataResponse.model.series);
        }
    }

    private buildXYData(seriesObj: XYSeries[]) {
        const dataSetArray = new Array<any>();
        let xValues: number[] = [];
        seriesObj.forEach(series => {
            const color = this.getSeriesColor(series.seriesName);
            xValues = series.xValues;
            dataSetArray.push({
                label: series.seriesName,
                fill: false,
                borderColor: color,
                borderWidth: 2,
                data: series.yValues
            });
        });
        const lineData = {
            labels: xValues,
            datasets: dataSetArray
        };

        this.setState({
            xyData: lineData
        });
    }

    private getSeriesColor(key: string): string {
        const colors = ['rgba(191, 33, 30, 1)', 'rgba(30, 56, 136, 1)', 'rgba(71, 168, 189, 1)', 'rgba(245, 230, 99, 1)', 'rgba(255, 173, 105, 1)',
            'rgba(216, 219, 226, 1)', 'rgba(212, 81, 19, 1)', 'rgba(187, 155, 176  , 1)', 'rgba(6, 214, 160, 1)', 'rgba(239, 71, 111, 1)'];
        let colorIndex = this.colorMap.get(key);
        if (colorIndex === undefined) {
            colorIndex = this.currentColorIndex % colors.length;
            this.colorMap.set(key, colorIndex);
            this.currentColorIndex++;
        }
        return colors[colorIndex];
    }
}
